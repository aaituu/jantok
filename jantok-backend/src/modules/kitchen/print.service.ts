import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrintDocumentType, Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../database/prisma.service.js';
import type { PrintDocumentDto } from './kitchen.dto.js';

const escape = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const map = (value: Prisma.JsonValue) => value as Record<string, unknown>;

@Injectable()
export class PrintService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actorUserId: string, dto: PrintDocumentDto) {
    const prior = await this.prisma.printDocument.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (prior) return prior;
    const source = await this.source(dto);
    const html = this.html(dto.type, dto.pageSize, source);
    const sha256 = createHash('sha256').update(html).digest('hex');
    return this.prisma.printDocument.create({
      data: {
        type: dto.type,
        revisionId: dto.revisionId,
        packingTaskId: dto.packingTaskId,
        reprintOfId: dto.reprintOfId,
        idempotencyKey: dto.idempotencyKey,
        fileName: `${dto.type.toLowerCase()}-${dto.revisionId ?? dto.packingTaskId}.pdf`,
        pageSize: dto.pageSize,
        contentSnapshot: source as Prisma.InputJsonValue,
        htmlContent: html,
        sha256,
        generatedByUserId: actorUserId,
      },
    });
  }

  history() {
    return this.prisma.printDocument.findMany({
      orderBy: { generatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        type: true,
        fileName: true,
        pageSize: true,
        sha256: true,
        reprintOfId: true,
        generatedByUserId: true,
        generatedAt: true,
      },
    });
  }

  async htmlPreview(id: string) {
    return (
      await this.prisma.printDocument.findUniqueOrThrow({ where: { id } })
    ).htmlContent;
  }

  async pdf(id: string) {
    const document = await this.prisma.printDocument.findUnique({
      where: { id },
    });
    if (!document) throw new NotFoundException('Print document not found');
    const source = document.contentSnapshot as Record<string, unknown>;
    const size = this.pdfSize(document.pageSize);
    const pdf = new PDFDocument({
      size,
      margin: document.type === PrintDocumentType.LABEL ? 14 : 36,
      info: { Title: document.fileName, Author: 'JANTOK Food' },
    });
    const fontPath = new URL(
      '../../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf',
      import.meta.url,
    ).pathname;
    pdf.registerFont('NotoSans', fontPath);
    pdf.font('NotoSans');
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => {
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });
    this.draw(pdf, document.type, source);
    pdf.end();
    return completed;
  }

  private async source(dto: PrintDocumentDto) {
    if (dto.type === 'PRODUCTION_LIST') {
      if (!dto.revisionId)
        throw new NotFoundException('revisionId is required');
      const revision = await this.prisma.productionRevision.findUnique({
        where: { id: dto.revisionId },
        include: {
          lines: { orderBy: [{ lineKind: 'asc' }, { itemCode: 'asc' }] },
          ingredientNeeds: { include: { ingredient: true } },
        },
      });
      if (!revision)
        throw new NotFoundException('Production revision not found');
      return JSON.parse(JSON.stringify(revision)) as Record<string, unknown>;
    }
    if (!dto.packingTaskId)
      throw new NotFoundException('packingTaskId is required');
    const task = await this.prisma.packingTask.findUnique({
      where: { id: dto.packingTaskId },
      include: { items: { orderBy: { itemKey: 'asc' } }, fulfillment: true },
    });
    if (!task) throw new NotFoundException('Packing task not found');
    return JSON.parse(JSON.stringify(task)) as Record<string, unknown>;
  }

  private html(
    type: string,
    pageSize: string,
    source: Record<string, unknown>,
  ) {
    const isProduction = type === 'PRODUCTION_LIST';
    const rows = isProduction
      ? ((source.lines as Array<Record<string, unknown>>) ?? [])
          .map(
            (line) =>
              `<tr><td>${escape(line.itemCode)}</td><td>${escape(line.portionKey)}</td><td>${escape(line.plannedQuantity)}</td><td>${escape(line.actualQuantity ?? '—')}</td><td>${escape(line.status)}</td></tr>`,
          )
          .join('')
      : ((source.items as Array<Record<string, unknown>>) ?? [])
          .map((item) => {
            const member = item.memberSnapshot as Record<string, unknown>;
            const content = item.contentSnapshot as Record<string, unknown>;
            return `<tr><td>${escape(member.displayName)}</td><td>${escape(content.code ?? content.mealType ?? item.itemType)}</td><td>${escape(item.quantity)}</td><td>${escape(item.restrictionLabel ?? '')}</td><td>${escape(item.status)}</td></tr>`;
          })
          .join('');
    const title =
      type === 'PRODUCTION_LIST'
        ? 'Production list'
        : type === 'LABEL'
          ? 'JANTOK FOOD - LABELS'
          : 'Packing list';
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>@page{size:${escape(pageSize)};margin:10mm}body{font-family:Arial,sans-serif;color:#17352b}h1{font-size:22px;margin:0 0 12px}.meta{color:#557067;margin-bottom:14px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #bfd3ca;padding:7px;text-align:left}th{background:#eaf4ef}.restriction{font-weight:bold;color:#9b2c2c}</style></head><body><h1>${title}</h1><div class="meta">JANTOK Food · ${escape(source.serviceDate ?? map(source.orderSnapshot as Prisma.JsonValue).serviceDate ?? '')} · ${escape(source.revision ?? source.id)}</div><table><thead><tr>${isProduction ? '<th>Item</th><th>Variant / portion</th><th>Plan</th><th>Actual</th><th>Status</th>' : '<th>Member</th><th>Contents</th><th>Qty</th><th>Individual restrictions</th><th>Status</th>'}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
  }

  private draw(
    pdf: PDFKit.PDFDocument,
    type: PrintDocumentType,
    source: Record<string, unknown>,
  ) {
    pdf
      .fillColor('#176B4D')
      .fontSize(type === 'LABEL' ? 15 : 20)
      .text('JANTOK FOOD');
    pdf
      .moveDown(0.4)
      .fillColor('#1F2937')
      .fontSize(type === 'LABEL' ? 10 : 13);
    if (type === PrintDocumentType.PRODUCTION_LIST) {
      pdf.text(
        `Production list · ${String(source.serviceDate).slice(0, 10)} · revision ${source.revision}`,
      );
      pdf.moveDown();
      for (const raw of (source.lines as Array<Record<string, unknown>>) ??
        []) {
        pdf.text(
          `${raw.itemCode} | ${raw.portionKey} | plan ${raw.plannedQuantity} | actual ${raw.actualQuantity ?? '-'} | ${raw.status}`,
        );
        const restrictions = raw.restrictionSnapshot as Record<string, unknown>;
        if (
          restrictions &&
          Object.values(restrictions).some(
            (value) => Array.isArray(value) && value.length,
          )
        )
          pdf
            .fillColor('#9B2C2C')
            .text(`INDIVIDUAL: ${JSON.stringify(restrictions)}`)
            .fillColor('#1F2937');
        pdf.moveDown(0.45);
      }
      return;
    }
    const order = source.orderSnapshot as Record<string, unknown>;
    pdf.text(
      `Order ${order.dailyOrderId ?? source.id} · ${order.serviceDate ?? ''}`,
    );
    pdf.moveDown(0.7);
    for (const raw of (source.items as Array<Record<string, unknown>>) ?? []) {
      const member = raw.memberSnapshot as Record<string, unknown>;
      const content = raw.contentSnapshot as Record<string, unknown>;
      pdf
        .fontSize(type === 'LABEL' ? 9 : 11)
        .text(
          `${member.displayName ?? 'Household'} · ${content.code ?? content.mealType ?? raw.itemType} × ${raw.quantity}`,
        );
      if (raw.restrictionLabel)
        pdf
          .fillColor('#9B2C2C')
          .text(String(raw.restrictionLabel))
          .fillColor('#1F2937');
      pdf.moveDown(0.45);
      if (type === PrintDocumentType.LABEL && pdf.y > pdf.page.height - 28)
        pdf.addPage({ size: this.pdfSize('58x40mm'), margin: 14 });
    }
  }

  private pdfSize(pageSize: string): PDFKit.PDFDocumentOptions['size'] {
    if (pageSize === '100x150mm') return [283.46, 425.2];
    if (pageSize === '58x40mm') return [164.41, 113.39];
    return 'A4';
  }
}
