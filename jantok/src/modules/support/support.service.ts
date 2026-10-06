import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Prisma, SupportThreadStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type {
  CreateSupportThreadDto,
  NotificationPreferenceDto,
  SendSupportMessageDto,
} from './support.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async household(userId: string) {
    const household = await this.prisma.household.findFirst({
      where: { ownerUserId: userId, deletedAt: null },
      select: { id: true },
    });
    if (!household) throw new NotFoundException('Household not found');
    return household;
  }

  async uploadCustomerAttachment(
    userId: string,
    file?: {
      buffer: Buffer;
      mimetype: string;
      size: number;
      originalname: string;
    },
  ) {
    if (!file)
      throw new UnprocessableEntityException({
        code: 'ATTACHMENT_REQUIRED',
        message: 'A photo attachment is required',
      });
    const contentTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (
      !contentTypes.has(file.mimetype) ||
      file.size > 5_000_000 ||
      file.size < 12 ||
      !this.matchesImageSignature(file.mimetype, file.buffer)
    )
      throw new UnprocessableEntityException({
        code: 'ATTACHMENT_INVALID',
        message: 'Only JPEG, PNG or WebP photos up to 5 MB are accepted',
      });
    const extension = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    }[file.mimetype];
    const objectKey = `support/${userId}/${randomUUID()}.${extension}`;
    const storage = this.storageClient();
    try {
      await storage.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET!,
          Key: objectKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          ContentLength: file.size,
          Metadata: { owner: userId },
        }),
      );
    } finally {
      storage.destroy();
    }
    return {
      objectKey,
      contentType: file.mimetype,
      sizeBytes: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  private matchesImageSignature(contentType: string, value: Buffer) {
    if (contentType === 'image/jpeg')
      return value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff;
    if (contentType === 'image/png')
      return value
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return (
      value.subarray(0, 4).toString('ascii') === 'RIFF' &&
      value.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }

  private storageClient() {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey || !process.env.S3_BUCKET)
      throw new UnprocessableEntityException({
        code: 'ATTACHMENT_STORAGE_UNAVAILABLE',
        message: 'Photo storage is not configured',
      });
    return new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private customerAttachments(userId: string, attachments?: unknown[]) {
    for (const raw of attachments ?? []) {
      const item = raw as { objectKey?: string };
      if (!item.objectKey?.startsWith(`support/${userId}/`))
        throw new ForbiddenException('Attachment does not belong to this user');
    }
    return (attachments ?? []) as Prisma.InputJsonValue;
  }

  async createThread(userId: string, dto: CreateSupportThreadDto) {
    const household = await this.household(userId);
    if (dto.dailyFulfillmentId) {
      const fulfillment = await this.prisma.dailyFulfillment.findFirst({
        where: { id: dto.dailyFulfillmentId, householdId: household.id },
        select: { id: true },
      });
      if (!fulfillment)
        throw new UnprocessableEntityException({
          code: 'FOREIGN_DAILY_ORDER',
          message: 'The daily order does not belong to this household',
        });
    }
    return this.prisma.$transaction(async (tx) => {
      const thread = await tx.supportThread.create({
        data: {
          householdId: household.id,
          ownerUserId: userId,
          dailyFulfillmentId: dto.dailyFulfillmentId,
          reason: dto.reason,
          positive: dto.reason === 'POSITIVE_FEEDBACK',
          subject: dto.subject.trim(),
          staffUnread: 1,
        },
      });
      await tx.supportMessage.create({
        data: {
          threadId: thread.id,
          authorType: 'CUSTOMER',
          authorUserId: userId,
          clientMessageId: dto.clientMessageId,
          body: dto.body.trim(),
          attachments: this.customerAttachments(userId, dto.attachments),
        },
      });
      return this.threadForCustomer(tx, thread.id, household.id);
    });
  }

  listCustomerThreads(userId: string) {
    return this.prisma.supportThread.findMany({
      where: { ownerUserId: userId },
      select: {
        id: true,
        reason: true,
        positive: true,
        subject: true,
        status: true,
        customerUnread: true,
        lastMessageAt: true,
        createdAt: true,
        dailyFulfillmentId: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, createdAt: true, authorType: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  async listCustomerMessages(userId: string, threadId: string, after?: string) {
    await this.assertCustomerThread(userId, threadId);
    return this.prisma.supportMessage.findMany({
      where: {
        threadId,
        ...(after ? { createdAt: { gt: new Date(after) } } : {}),
      },
      select: {
        id: true,
        authorType: true,
        clientMessageId: true,
        body: true,
        attachments: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
  }

  async sendCustomer(
    userId: string,
    threadId: string,
    dto: SendSupportMessageDto,
  ) {
    const thread = await this.assertCustomerThread(userId, threadId);
    if (thread.status === 'CLOSED')
      throw new UnprocessableEntityException(
        'Closed thread cannot accept messages',
      );
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.supportMessage.upsert({
        where: {
          threadId_clientMessageId: {
            threadId,
            clientMessageId: dto.clientMessageId,
          },
        },
        create: {
          threadId,
          authorType: 'CUSTOMER',
          authorUserId: userId,
          clientMessageId: dto.clientMessageId,
          body: dto.body.trim(),
          attachments: this.customerAttachments(userId, dto.attachments),
        },
        update: {},
      });
      await tx.supportThread.update({
        where: { id: threadId },
        data: {
          status: 'WAITING_FOR_SUPPORT',
          staffUnread: { increment: 1 },
          lastMessageAt: message.createdAt,
        },
      });
      return message;
    });
  }

  async markCustomerRead(userId: string, threadId: string) {
    await this.assertCustomerThread(userId, threadId);
    return this.prisma.supportThread.update({
      where: { id: threadId },
      data: { customerUnread: 0 },
      select: { id: true, customerUnread: true },
    });
  }

  listStaffThreads(query?: string, status?: SupportThreadStatus) {
    return this.prisma.supportThread.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(query
          ? {
              OR: [
                { subject: { contains: query, mode: 'insensitive' } },
                { owner: { phone: { contains: query } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        reason: true,
        positive: true,
        subject: true,
        status: true,
        staffUnread: true,
        lastMessageAt: true,
        createdAt: true,
        dailyFulfillmentId: true,
        owner: { select: { firstName: true, lastName: true, phone: true } },
        assignedEmployee: { select: { id: true, phone: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });
  }

  listStaffMessages(threadId: string, after?: string) {
    return this.prisma.supportMessage.findMany({
      where: {
        threadId,
        ...(after ? { createdAt: { gt: new Date(after) } } : {}),
      },
      select: {
        id: true,
        authorType: true,
        clientMessageId: true,
        body: true,
        attachments: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
  }

  async sendStaff(
    employeeId: string,
    threadId: string,
    dto: SendSupportMessageDto,
  ) {
    const thread = await this.prisma.supportThread.findUnique({
      where: { id: threadId },
    });
    if (!thread) throw new NotFoundException('Support thread not found');
    if (thread.status === 'CLOSED')
      throw new UnprocessableEntityException(
        'Closed thread cannot accept messages',
      );
    const message = await this.prisma.$transaction(async (tx) => {
      const message = await tx.supportMessage.upsert({
        where: {
          threadId_clientMessageId: {
            threadId,
            clientMessageId: dto.clientMessageId,
          },
        },
        create: {
          threadId,
          authorType: 'EMPLOYEE',
          authorEmployeeId: employeeId,
          clientMessageId: dto.clientMessageId,
          body: dto.body.trim(),
          attachments: (dto.attachments ??
            []) as unknown as Prisma.InputJsonValue,
        },
        update: {},
      });
      await tx.supportThread.update({
        where: { id: threadId },
        data: {
          assignedEmployeeId: thread.assignedEmployeeId ?? employeeId,
          status: 'WAITING_FOR_CUSTOMER',
          customerUnread: { increment: 1 },
          lastMessageAt: message.createdAt,
        },
      });
      return message;
    });
    await this.notifications.enqueue({
      userId: thread.ownerUserId,
      eventCode: 'SUPPORT_REPLY',
      idempotencyKey: `support-reply:${message.id}`,
      payload: {
        route: `/support/${threadId}`,
        entityId: threadId,
        eventCode: 'SUPPORT_REPLY',
      },
    });
    return message;
  }

  async changeStatus(
    actorUserId: string,
    employeeId: string,
    threadId: string,
    status: SupportThreadStatus,
    reason: string,
    requestId: string,
  ) {
    const thread = await this.prisma.supportThread.findUnique({
      where: { id: threadId },
    });
    if (!thread) throw new NotFoundException('Support thread not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supportThread.update({
        where: { id: threadId },
        data: {
          status,
          assignedEmployeeId: thread.assignedEmployeeId ?? employeeId,
          resolvedAt: ['RESOLVED', 'CLOSED'].includes(status)
            ? new Date()
            : null,
        },
      });
      await this.audit.record(
        {
          actorUserId,
          actorEmployeeId: employeeId,
          action: 'SUPPORT_STATUS_CHANGED',
          entityType: 'SupportThread',
          entityId: threadId,
          oldValues: { status: thread.status },
          newValues: { status },
          reason,
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  preferences(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  updatePreferences(userId: string, dto: NotificationPreferenceDto) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  async assertCustomerThread(userId: string, threadId: string) {
    const thread = await this.prisma.supportThread.findFirst({
      where: { id: threadId, ownerUserId: userId },
      select: { id: true, status: true, householdId: true },
    });
    if (!thread)
      throw new ForbiddenException('Thread does not belong to this user');
    return thread;
  }

  async assertStaffPermission(userId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        roles: {
          some: {
            role: {
              permissions: { some: { permission: { code: 'support.manage' } } },
            },
          },
        },
      },
      select: { id: true },
    });
    if (!employee) throw new ForbiddenException('support.manage is required');
    return employee;
  }

  private threadForCustomer(
    tx: Prisma.TransactionClient,
    id: string,
    householdId: string,
  ) {
    return tx.supportThread.findFirstOrThrow({
      where: { id, householdId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }
}
