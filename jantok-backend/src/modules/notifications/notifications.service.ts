import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { PushProvider } from './push-provider.js';

const SAFE_FALLBACKS: Record<string, { title: string; body: string }> = {
  ORDER_IN_PRODUCTION: { title: 'JANTOK', body: 'Ваш заказ готовится.' },
  COURIER_DEPARTED: { title: 'JANTOK', body: 'Курьер выехал.' },
  DELIVERY_APPROACHING: { title: 'JANTOK', body: 'Доставка приближается.' },
  TOMORROW_MENU_AVAILABLE: {
    title: 'JANTOK',
    body: 'Меню на завтра доступно.',
  },
  CUTOFF_REMINDER: {
    title: 'JANTOK',
    body: 'Проверьте заказ до окончания времени изменений.',
  },
  RENEWAL_NOTICE: {
    title: 'JANTOK',
    body: 'Скоро продление подписки. Проверьте условия.',
  },
  PAYMENT_RESULT: { title: 'JANTOK', body: 'Статус оплаты обновлён.' },
  ORDER_PROBLEM: {
    title: 'JANTOK',
    body: 'По заказу требуется ваше внимание.',
  },
  SUPPORT_REPLY: {
    title: 'JANTOK Поддержка',
    body: 'В обращении появился новый ответ.',
  },
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PushProvider,
  ) {}

  async enqueue(input: {
    userId: string;
    eventCode: string;
    idempotencyKey: string;
    serviceMessage?: boolean;
    payload?: Record<string, string>;
  }) {
    const existing = await this.prisma.notificationOutbox.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;
    const preference = await this.prisma.notificationPreference.findUnique({
      where: { userId: input.userId },
    });
    const serviceMessage = input.serviceMessage ?? true;
    if (
      (!serviceMessage && !preference?.marketingPushEnabled) ||
      (serviceMessage && preference?.servicePushEnabled === false)
    )
      return null;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { locale: true },
    });
    const locale = preference?.locale ?? user.locale;
    const template = await this.prisma.notificationTemplate.findFirst({
      where: {
        eventCode: input.eventCode,
        locale,
        status:
          process.env.APP_ENV === 'production'
            ? 'APPROVED'
            : { in: ['APPROVED', 'DEMO'] },
      },
      orderBy: [{ status: 'asc' }, { version: 'desc' }],
    });
    const fallback = SAFE_FALLBACKS[input.eventCode] ?? {
      title: 'JANTOK',
      body: 'В приложении есть обновление.',
    };
    const safePayload = Object.fromEntries(
      Object.entries(input.payload ?? {}).filter(([key]) =>
        ['route', 'entityId', 'eventCode'].includes(key),
      ),
    );
    return this.prisma.notificationOutbox.create({
      data: {
        userId: input.userId,
        eventCode: input.eventCode,
        idempotencyKey: input.idempotencyKey,
        serviceMessage,
        locale,
        title: template?.titleTemplate ?? fallback.title,
        body: template?.bodyTemplate ?? fallback.body,
        payload: safePayload as Prisma.InputJsonValue,
      },
    });
  }

  list() {
    return this.prisma.notificationOutbox.findMany({
      select: {
        id: true,
        userId: true,
        eventCode: true,
        serviceMessage: true,
        locale: true,
        title: true,
        body: true,
        status: true,
        attempts: true,
        nextAttemptAt: true,
        providerMessageId: true,
        lastError: true,
        sentAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async dispatchDue(limit = 100) {
    const rows = await this.prisma.notificationOutbox.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { lte: new Date() },
        attempts: { lt: 4 },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(100, Math.max(1, limit)),
    });
    const results = [];
    for (const row of rows) {
      try {
        const result = await this.provider.send({
          userId: row.userId,
          title: row.title,
          body: row.body,
          payload: row.payload as Record<string, string>,
          idempotencyKey: row.idempotencyKey,
        });
        results.push(
          await this.prisma.notificationOutbox.update({
            where: { id: row.id },
            data: {
              status: 'SENT',
              attempts: { increment: 1 },
              providerMessageId: result.providerMessageId,
              sentAt: result.acceptedAt,
              lastError: null,
            },
          }),
        );
      } catch (error) {
        results.push(
          await this.prisma.notificationOutbox.update({
            where: { id: row.id },
            data: {
              status: 'FAILED',
              attempts: { increment: 1 },
              nextAttemptAt: new Date(Date.now() + 60_000 * 2 ** row.attempts),
              lastError:
                error instanceof Error
                  ? error.message.slice(0, 500)
                  : 'Push failed',
            },
          }),
        );
      }
    }
    return results;
  }
}
