import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import type { AnalyticsQueryDto, CreateExportDto } from './analytics.dto.js';

type ReportRow = Record<string, string | number | boolean | null>;

const REPORT_PERMISSION: Record<string, string> = {
  FINANCIAL: 'payments.refund',
  KITCHEN: 'kitchen.manage',
  INVENTORY: 'inventory.manage',
  CUSTOMERS: 'users.view',
  SUBSCRIPTIONS: 'subscriptions.edit',
  DELIVERY: 'delivery.manage',
  WASTE: 'inventory.manage',
  MEALS: 'menu.edit',
};

function range(query: AnalyticsQueryDto) {
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const from = query.from
    ? new Date(`${query.from}T00:00:00.000Z`)
    : new Date(to.getTime() - 29 * 86400000);
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from > to
  )
    throw new UnprocessableEntityException('Invalid analytics period');
  if (to.getTime() - from.getTime() > 366 * 86400000)
    throw new UnprocessableEntityException(
      'Analytics period is limited to 366 days',
    );
  return { from, to };
}

export function safeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: AnalyticsQueryDto) {
    const { from, to } = range(query);
    const created = { gte: from, lte: to };
    const [
      purchases,
      refunds,
      bonusIssued,
      bonusSpent,
      registrations,
      activeCustomers,
      householdMembers,
      subscriptions,
      reviews,
      production,
      waste,
      inventory,
      deliveries,
      referrals,
      clubMembers,
      support,
    ] = await Promise.all([
      this.prisma.purchase.aggregate({
        where: {
          paidAt: created,
          status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
        },
        _sum: { cashKzt: true, bonusKzt: true },
        _avg: { cashKzt: true },
        _count: true,
      }),
      this.prisma.refund.aggregate({
        where: { authoritativeAt: created, status: 'SUCCEEDED' },
        _sum: { cashKzt: true, bonusKzt: true },
        _count: true,
      }),
      this.prisma.bonusLedgerEntry.aggregate({
        where: { createdAt: created, amountKzt: { gt: 0 } },
        _sum: { amountKzt: true },
      }),
      this.prisma.bonusLedgerEntry.aggregate({
        where: { createdAt: created, amountKzt: { lt: 0 } },
        _sum: { amountKzt: true },
      }),
      this.prisma.user.count({
        where: { createdAt: created, deletedAt: null },
      }),
      this.prisma.user.count({
        where: {
          status: 'ACTIVE',
          household: { subscriptions: { some: { status: 'ACTIVE' } } },
        },
      }),
      this.prisma.householdMember.count({
        where: { createdAt: created, deletedAt: null },
      }),
      this.prisma.subscription.groupBy({
        by: ['status'],
        where: { createdAt: created },
        _count: true,
      }),
      this.prisma.mealReview.aggregate({
        where: { createdAt: created, status: 'PUBLISHED' },
        _avg: { rating: true },
        _count: true,
      }),
      this.prisma.productionLine.aggregate({
        where: { revision: { serviceDate: { gte: from, lte: to } } },
        _sum: { plannedQuantity: true, actualQuantity: true },
        _count: true,
      }),
      this.prisma.wasteEntry.aggregate({
        where: { wasteDate: { gte: from, lte: to } },
        _sum: { costKzt: true, quantity: true },
        _count: true,
      }),
      this.prisma.inventoryBalance.aggregate({
        _sum: { onHandQuantity: true, reservedQuantity: true },
        _count: true,
      }),
      this.prisma.dailyFulfillment.groupBy({
        by: ['status'],
        where: { serviceDate: { gte: from, lte: to } },
        _count: true,
      }),
      this.prisma.referral.groupBy({
        by: ['status'],
        where: { createdAt: created },
        _count: true,
      }),
      this.prisma.clubMembership.groupBy({ by: ['tierId'], _count: true }),
      this.prisma.supportThread.groupBy({
        by: ['reason', 'status'],
        where: { createdAt: created },
        _count: true,
      }),
    ]);
    const revenue = purchases._sum.cashKzt ?? 0;
    const refundCash = refunds._sum.cashKzt ?? 0;
    const wasteCost = Number(waste._sum.costKzt ?? 0);
    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
        timezone: 'Asia/Almaty',
      },
      definitions: {
        revenueKzt:
          'Sum purchase.cashKzt for authoritative paid/refunded purchases by paidAt; gross of refunds.',
        netRevenueKzt:
          'Revenue minus SUCCEEDED refund.cashKzt by authoritativeAt.',
        activeCustomers:
          'ACTIVE users whose household has at least one ACTIVE subscription at query time.',
        deliveryStatuses:
          'Daily fulfillment count by physical status and serviceDate; refund state is separate.',
      },
      finance: {
        revenueKzt: revenue,
        refundsKzt: refundCash,
        netRevenueKzt: revenue - refundCash,
        averageSubscriptionCashKzt: Math.round(purchases._avg.cashKzt ?? 0),
        bonusesIssued: bonusIssued._sum.amountKzt ?? 0,
        bonusesSpent: Math.abs(bonusSpent._sum.amountKzt ?? 0),
        paidPurchases: purchases._count,
        successfulRefunds: refunds._count,
        wasteCostKzt: wasteCost,
      },
      customers: { registrations, activeCustomers, householdMembers },
      subscriptions: Object.fromEntries(
        subscriptions.map((item) => [item.status, item._count]),
      ),
      nutrition: { memberProfiles: householdMembers },
      menu: {
        publishedReviewCount: reviews._count,
        averageRating: reviews._avg.rating ?? null,
      },
      kitchen: {
        lines: production._count,
        plannedPortions: production._sum.plannedQuantity ?? 0,
        producedPortions: production._sum.actualQuantity ?? 0,
      },
      inventory: {
        balanceRows: inventory._count,
        onHandQuantity: Number(inventory._sum.onHandQuantity ?? 0),
        reservedQuantity: Number(inventory._sum.reservedQuantity ?? 0),
        wasteQuantity: Number(waste._sum.quantity ?? 0),
      },
      delivery: Object.fromEntries(
        deliveries.map((item) => [item.status, item._count]),
      ),
      referral: Object.fromEntries(
        referrals.map((item) => [item.status, item._count]),
      ),
      club: { membershipsByTier: clubMembers },
      support: {
        tickets: support.reduce((sum, item) => sum + item._count, 0),
        breakdown: support,
      },
    };
  }

  async createExport(
    employeeId: string,
    permissions: string[],
    dto: CreateExportDto,
  ) {
    const required = REPORT_PERMISSION[dto.reportType];
    if (
      required &&
      !permissions.includes(required) &&
      !permissions.includes('roles.manage')
    )
      throw new ForbiddenException({
        code: 'EXPORT_FIELD_SCOPE_DENIED',
        message: `${required} is required for ${dto.reportType} detail exports`,
      });
    const filters = {
      from: dto.from ?? null,
      to: dto.to ?? null,
      status: dto.status ?? null,
    };
    const job = await this.prisma.exportJob.create({
      data: {
        creatorEmployeeId: employeeId,
        reportType: dto.reportType,
        format: dto.format,
        status: 'PROCESSING',
        progress: 10,
        filters,
        columns: [],
        units: { money: 'KZT', dateTime: 'ISO-8601', timezone: 'Asia/Almaty' },
      },
    });
    try {
      const rows = await this.reportRows(dto.reportType, dto);
      const columns = rows.length
        ? Object.keys(rows[0])
        : this.emptyColumns(dto.reportType);
      const data =
        dto.format === 'CSV'
          ? Buffer.from(
              this.csv(dto.reportType, filters, columns, rows),
              'utf8',
            )
          : await this.xlsx(dto.reportType, filters, columns, rows);
      const extension = dto.format.toLowerCase();
      return await this.prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          progress: 100,
          rowCount: rows.length,
          columns,
          fileName: `jantok-${dto.reportType.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${extension}`,
          mimeType:
            dto.format === 'CSV'
              ? 'text/csv; charset=utf-8'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileData: data,
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
        select: this.jobSelect(),
      });
    } catch (error) {
      await this.prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage:
            error instanceof Error
              ? error.message.slice(0, 500)
              : 'Export failed',
        },
      });
      throw error;
    }
  }

  listExports(employeeId: string) {
    return this.prisma.exportJob.findMany({
      where: { creatorEmployeeId: employeeId },
      select: this.jobSelect(),
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async download(employeeId: string, id: string) {
    const job = await this.prisma.exportJob.findFirst({
      where: {
        id,
        creatorEmployeeId: employeeId,
        status: 'COMPLETED',
        expiresAt: { gt: new Date() },
      },
    });
    if (!job?.fileData || !job.fileName || !job.mimeType)
      throw new NotFoundException('Export is unavailable or expired');
    return {
      data: Buffer.from(job.fileData),
      fileName: job.fileName,
      mimeType: job.mimeType,
    };
  }

  private async reportRows(
    reportType: string,
    query: AnalyticsQueryDto,
  ): Promise<ReportRow[]> {
    const { from, to } = range(query);
    const created = { gte: from, lte: to };
    if (reportType === 'FINANCIAL') {
      const rows = await this.prisma.purchase.findMany({
        where: {
          createdAt: created,
          ...(query.status ? { status: query.status as never } : {}),
        },
        include: { refunds: { where: { status: 'SUCCEEDED' } }, quote: true },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => ({
        purchaseId: row.id,
        createdAt: row.createdAt.toISOString(),
        paidAt: row.paidAt?.toISOString() ?? null,
        status: row.status,
        subtotalKzt: row.quote.subtotalKzt,
        discountKzt: row.quote.discountKzt,
        cashKzt: row.cashKzt,
        bonusKzt: row.bonusKzt,
        refundedCashKzt: row.refunds.reduce(
          (sum, item) => sum + item.cashKzt,
          0,
        ),
        refundedBonusKzt: row.refunds.reduce(
          (sum, item) => sum + item.bonusKzt,
          0,
        ),
      }));
    }
    if (reportType === 'CUSTOMERS') {
      const rows = await this.prisma.user.findMany({
        where: {
          createdAt: created,
          deletedAt: null,
          ...(query.status ? { status: query.status as never } : {}),
        },
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true,
          status: true,
          locale: true,
          createdAt: true,
          household: {
            select: {
              _count: { select: { members: true, subscriptions: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => ({
        userId: row.id,
        phone: row.phone,
        firstName: row.firstName,
        lastName: row.lastName,
        status: row.status,
        locale: row.locale,
        members: row.household?._count.members ?? 0,
        subscriptions: row.household?._count.subscriptions ?? 0,
        registeredAt: row.createdAt.toISOString(),
      }));
    }
    if (reportType === 'SUBSCRIPTIONS') {
      const rows = await this.prisma.subscription.findMany({
        where: {
          createdAt: created,
          ...(query.status ? { status: query.status as never } : {}),
        },
        select: {
          id: true,
          status: true,
          startDate: true,
          currentEndDate: true,
          paidServiceDays: true,
          autoRenew: true,
          householdId: true,
          createdAt: true,
          _count: { select: { participants: true, serviceDays: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => ({
        subscriptionId: row.id,
        householdId: row.householdId,
        status: row.status,
        startDate: row.startDate.toISOString().slice(0, 10),
        currentEndDate: row.currentEndDate.toISOString().slice(0, 10),
        paidServiceDays: row.paidServiceDays,
        generatedServiceDays: row._count.serviceDays,
        participants: row._count.participants,
        autoRenew: row.autoRenew,
      }));
    }
    if (reportType === 'DELIVERY') {
      const rows = await this.prisma.dailyFulfillment.findMany({
        where: {
          serviceDate: created,
          ...(query.status ? { status: query.status as never } : {}),
        },
        include: {
          deliveryAttempts: { orderBy: { attemptNumber: 'desc' }, take: 1 },
        },
        orderBy: { serviceDate: 'asc' },
      });
      return rows.map((row) => ({
        fulfillmentId: row.id,
        serviceDate: row.serviceDate.toISOString().slice(0, 10),
        slot: JSON.stringify(row.slotSnapshot),
        status: row.status,
        financialStatus: row.financialStatus,
        dispatchAt: row.dispatchAt.toISOString(),
        provider: row.deliveryAttempts[0]?.provider ?? null,
        providerStatus: row.deliveryAttempts[0]?.providerStatus ?? null,
      }));
    }
    if (reportType === 'INVENTORY') {
      const rows = await this.prisma.inventoryBalance.findMany({
        include: { ingredient: true, storageLocation: true },
        orderBy: [
          { ingredient: { code: 'asc' } },
          { storageLocation: { code: 'asc' } },
        ],
      });
      return rows.map((row) => ({
        ingredientCode: row.ingredient.code,
        ingredientName: row.ingredient.nameRu,
        location: row.storageLocation.name,
        unit: row.ingredient.inventoryUnit,
        onHand: Number(row.onHandQuantity),
        reserved: Number(row.reservedQuantity),
        available: Number(row.onHandQuantity) - Number(row.reservedQuantity),
        averageCostKzt: Number(row.averageCostKzt),
      }));
    }
    if (reportType === 'WASTE') {
      const rows = await this.prisma.wasteEntry.findMany({
        where: { wasteDate: created },
        include: { ingredient: true },
        orderBy: { wasteDate: 'asc' },
      });
      return rows.map((row) => ({
        wasteId: row.id,
        date: row.wasteDate.toISOString().slice(0, 10),
        ingredientCode: row.ingredient.code,
        quantity: Number(row.quantity),
        unit: row.canonicalUnit,
        costKzt: Number(row.costKzt),
        reason: row.reason,
        shift: row.shiftCode,
      }));
    }
    if (reportType === 'KITCHEN') {
      const rows = await this.prisma.productionLine.findMany({
        where: { revision: { serviceDate: created } },
        include: { revision: true },
        orderBy: [{ revision: { serviceDate: 'asc' } }, { itemCode: 'asc' }],
      });
      return rows.map((row) => ({
        date: row.revision.serviceDate.toISOString().slice(0, 10),
        revision: row.revision.revision,
        kind: row.revision.kind,
        itemCode: row.itemCode,
        portionKey: row.portionKey,
        planned: row.plannedQuantity,
        actual: row.actualQuantity,
        status: row.status,
      }));
    }
    if (reportType === 'MEALS') {
      const rows = await this.prisma.meal.findMany({
        include: {
          translations: true,
          reviews: { where: { status: 'PUBLISHED' } },
        },
        orderBy: { code: 'asc' },
      });
      return rows.map((row) => ({
        mealId: row.id,
        code: row.code,
        mealType: row.mealType,
        nameRu:
          row.translations.find((item) => item.locale === 'ru')?.name ??
          row.code,
        caloriesKcal: Number(row.caloriesKcal),
        rating: Number(row.ratingAverage),
        reviews: row.reviews.length,
      }));
    }
    throw new UnprocessableEntityException('Unsupported report type');
  }

  private csv(
    reportType: string,
    filters: Record<string, unknown>,
    columns: string[],
    rows: ReportRow[],
  ) {
    const quote = (value: unknown) =>
      `"${String(safeCell(value) ?? '').replaceAll('"', '""')}"`;
    const lines = [
      ['Report', reportType],
      ['Generated at', new Date().toISOString()],
      ['Business timezone', 'Asia/Almaty'],
      ['Currency', 'KZT'],
      ['Filters', JSON.stringify(filters)],
      [],
      columns,
      ...rows.map((row) => columns.map((column) => row[column])),
    ];
    return `\uFEFF${lines.map((line) => line.map(quote).join(',')).join('\r\n')}`;
  }

  private async xlsx(
    reportType: string,
    filters: Record<string, unknown>,
    columns: string[],
    rows: ReportRow[],
  ) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'JANTOK';
    workbook.created = new Date();
    const metadata = workbook.addWorksheet('Metadata');
    metadata.addRows([
      ['Report', reportType],
      ['Generated at', new Date().toISOString()],
      ['Business timezone', 'Asia/Almaty'],
      ['Currency', 'KZT'],
      ['Filters', JSON.stringify(filters)],
    ]);
    metadata.getColumn(1).width = 24;
    metadata.getColumn(2).width = 80;
    const sheet = workbook.addWorksheet('Data', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = columns.map((key) => ({ header: key, key, width: 22 }));
    for (const row of rows)
      sheet.addRow(
        Object.fromEntries(
          columns.map((column) => [column, safeCell(row[column])]),
        ),
      );
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: {
        row: Math.max(1, rows.length + 1),
        column: Math.max(1, columns.length),
      },
    };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF176B4D' },
    };
    const output = await workbook.xlsx.writeBuffer();
    return Buffer.from(output);
  }

  private emptyColumns(reportType: string) {
    return reportType === 'FINANCIAL'
      ? ['purchaseId', 'createdAt', 'status', 'cashKzt']
      : ['id'];
  }

  private jobSelect() {
    return {
      id: true,
      reportType: true,
      format: true,
      status: true,
      progress: true,
      filters: true,
      columns: true,
      units: true,
      currency: true,
      rowCount: true,
      fileName: true,
      mimeType: true,
      errorMessage: true,
      expiresAt: true,
      createdAt: true,
      completedAt: true,
    } satisfies Prisma.ExportJobSelect;
  }
}
