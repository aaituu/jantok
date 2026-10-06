import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  OutboxStatus,
  PaymentAttemptStatus,
  Prisma,
  ProviderEventStatus,
  PurchaseStatus,
  QuoteStatus,
  ReceiptStatus,
  RefundKind,
  RefundStatus,
  RenewalStatus,
  ServiceDayEventType,
  ServiceDayStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AdminRefundDto,
  ConfigureAutoRenewDto,
  PaymentCheckoutDto,
  RefundRequestDto,
  RegisterReceiptDto,
} from './payment.dto.js';
import {
  FISCALIZATION_PROVIDER,
  type FiscalizationProvider,
} from './fiscalization-provider.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderPayment,
} from './payment-provider.js';
import { calculateStandardRefund, renewalSchedule } from './payment-policy.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import type {
  RecurringAddonDto,
  RecurringAddonRefundDto,
} from '../loyalty/loyalty.dto.js';

const DAY = 86_400_000;
const plusDays = (value: Date, count: number) =>
  new Date(value.getTime() + count * DAY);
const dayString = (value: Date) => value.toISOString().slice(0, 10);
const providerStatus = (status: ProviderPayment['status']) =>
  ({
    PENDING: PaymentAttemptStatus.PENDING,
    REQUIRES_ACTION: PaymentAttemptStatus.REQUIRES_ACTION,
    CAPTURED: PaymentAttemptStatus.CAPTURED,
    FAILED: PaymentAttemptStatus.FAILED,
    CANCELLED: PaymentAttemptStatus.CANCELLED,
    UNKNOWN: PaymentAttemptStatus.UNKNOWN,
  })[status];

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(FISCALIZATION_PROVIDER)
    private readonly fiscalization: FiscalizationProvider,
    private readonly loyalty: LoyaltyService,
  ) {}

  async checkoutRecurringAddon(
    userId: string,
    dto: RecurringAddonDto,
    now = new Date(),
  ) {
    const plan = await this.loyalty.prepareRecurringAddon(userId, dto, now);
    if (plan.status === 'ACTIVE' || plan.status === 'PAYMENT_FAILED')
      return plan;
    if (plan.cashKzt === 0)
      return this.loyalty.finalizeRecurringAddon(plan.id, now);
    if (
      !['local', 'test'].includes(process.env.APP_ENV ?? 'local') ||
      this.provider.code === 'UNCONFIGURED'
    )
      throw new UnprocessableEntityException({
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message: 'Production payment provider is not configured',
      });
    let result: ProviderPayment;
    try {
      result = plan.providerReference
        ? await this.provider.getPayment(plan.providerReference)
        : await this.provider.createPayment({
            idempotencyKey: `addon-payment:${plan.idempotencyKey}`,
            purchaseId: plan.id,
            amountKzt: plan.cashKzt,
            returnUrl: dto.returnUrl,
            saveMethod: false,
          });
    } catch {
      await this.prisma.recurringAddonPlan.update({
        where: { id: plan.id },
        data: {
          paymentStatus: PaymentAttemptStatus.UNKNOWN,
          providerResponseSnapshot: {
            error: 'Provider result unknown; reconcile same add-on operation',
          },
        },
      });
      return {
        id: plan.id,
        status: 'PENDING_PAYMENT',
        paymentStatus: 'UNKNOWN',
        action: 'WAIT_FOR_RECONCILIATION',
      };
    }
    return this.loyalty.recordAddonPayment(plan.id, result);
  }

  async refundRecurringAddon(userId: string, dto: RecurringAddonRefundDto) {
    const prior = await this.prisma.recurringAddonRefund.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (prior) {
      if (prior.planId !== dto.planId)
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Idempotency key belongs to another add-on refund',
        });
      return prior;
    }
    const refund = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.recurringAddonPlan.findFirst({
        where: {
          id: dto.planId,
          household: { ownerUserId: userId },
          status: 'ACTIVE',
          paymentStatus: PaymentAttemptStatus.CAPTURED,
        },
        include: { refunds: true, allocations: true },
      });
      if (!plan) throw new NotFoundException('Paid recurring add-on not found');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${plan.id}, 0))`;
      const reserved = plan.refunds.filter(
        (item) =>
          item.status === RefundStatus.PENDING ||
          item.status === RefundStatus.SUCCEEDED,
      );
      const reservedUnits = reserved.reduce((sum, item) => sum + item.units, 0);
      if (dto.units + reservedUnits > plan.paidUnits)
        throw new UnprocessableEntityException({
          code: 'ADDON_REFUND_UNITS_EXCEEDED',
          message: 'Refund exceeds paid and unrefunded add-on units',
        });
      const refundableUnits = plan.allocations
        .filter((item) => item.status === 'PLANNED')
        .reduce((sum, item) => sum + item.quantity, 0);
      if (dto.units > refundableUnits)
        throw new UnprocessableEntityException({
          code: 'ADDON_UNITS_ALREADY_USED',
          message: 'Only future planned add-on units can be refunded',
        });
      const amountKzt = dto.units * plan.unitPriceKzt;
      const refundedCash = reserved.reduce(
        (sum, item) => sum + item.cashKzt,
        0,
      );
      const refundedBonus = reserved.reduce(
        (sum, item) => sum + item.bonusKzt,
        0,
      );
      const availableCash = plan.cashKzt - refundedCash;
      const availableBonus = plan.bonusKzt - refundedBonus;
      let cashKzt = Math.min(
        availableCash,
        plan.totalKzt
          ? Math.floor((amountKzt * plan.cashKzt) / plan.totalKzt)
          : 0,
      );
      let bonusKzt = Math.min(availableBonus, amountKzt - cashKzt);
      cashKzt += Math.min(
        availableCash - cashKzt,
        amountKzt - cashKzt - bonusKzt,
      );
      if (cashKzt + bonusKzt !== amountKzt)
        throw new UnprocessableEntityException({
          code: 'ADDON_REFUND_AMOUNT_EXCEEDED',
          message: 'Refund exceeds remaining paid amount',
        });
      return tx.recurringAddonRefund.create({
        data: {
          planId: plan.id,
          idempotencyKey: dto.idempotencyKey,
          units: dto.units,
          cashKzt,
          bonusKzt,
          reason: dto.reason,
          status: cashKzt > 0 ? RefundStatus.PENDING : RefundStatus.SUCCEEDED,
        },
        include: { plan: true },
      });
    });
    if (refund.cashKzt === 0)
      return this.finalizeRecurringAddonRefund(refund.id);
    if (!refund.plan.providerReference)
      throw new UnprocessableEntityException(
        'Captured add-on payment is required',
      );
    try {
      const result = await this.provider.refund({
        idempotencyKey: `addon-refund:${dto.idempotencyKey}`,
        operationId: refund.plan.providerReference,
        amountKzt: refund.cashKzt,
        reason: dto.reason,
      });
      await this.prisma.recurringAddonRefund.update({
        where: { id: refund.id },
        data: {
          providerRefundReference: result.refundId,
          status:
            result.status === 'SUCCEEDED'
              ? RefundStatus.SUCCEEDED
              : result.status === 'FAILED'
                ? RefundStatus.FAILED
                : RefundStatus.PENDING,
          providerResponseSnapshot:
            result.safeSnapshot as Prisma.InputJsonValue,
        },
      });
      if (result.status === 'SUCCEEDED')
        return this.finalizeRecurringAddonRefund(refund.id);
    } catch {
      return this.prisma.recurringAddonRefund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.PENDING,
          providerResponseSnapshot: {
            error:
              'Provider result unknown; retry same add-on refund operation',
          },
        },
      });
    }
    return this.prisma.recurringAddonRefund.findUniqueOrThrow({
      where: { id: refund.id },
    });
  }

  private async finalizeRecurringAddonRefund(refundId: string) {
    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.recurringAddonRefund.findUniqueOrThrow({
        where: { id: refundId },
        include: {
          plan: {
            include: {
              allocations: { include: { serviceDay: true } },
            },
          },
        },
      });
      if (refund.finalizedAt) return refund;
      if (refund.status !== RefundStatus.SUCCEEDED) return refund;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${refund.planId}, 0))`;
      let units = refund.units;
      for (const allocation of refund.plan.allocations
        .filter((item) => item.status === 'PLANNED')
        .sort(
          (a, b) =>
            b.serviceDay.serviceDate.getTime() -
            a.serviceDay.serviceDate.getTime(),
        )) {
        if (units <= 0) break;
        if (allocation.quantity <= units) {
          units -= allocation.quantity;
          await tx.recurringAddonAllocation.update({
            where: { id: allocation.id },
            data: { status: 'CANCELLED' },
          });
        } else {
          await tx.recurringAddonAllocation.update({
            where: { id: allocation.id },
            data: { quantity: { decrement: units } },
          });
          units = 0;
        }
      }
      if (units > 0)
        throw new UnprocessableEntityException({
          code: 'ADDON_UNITS_ALREADY_USED',
          message: 'Requested units are no longer refundable',
        });
      if (refund.bonusKzt > 0)
        await tx.bonusLedgerEntry.upsert({
          where: { idempotencyKey: `bonus:addon-refund:${refund.id}` },
          create: {
            householdId: refund.plan.householdId,
            idempotencyKey: `bonus:addon-refund:${refund.id}`,
            sourceKey: `recurring-addon-refund:${refund.id}`,
            type: 'REFUND',
            amountKzt: refund.bonusKzt,
            reason: 'Recurring add-on units refunded',
          },
          update: {},
        });
      await tx.addon.update({
        where: { id: refund.plan.addonId },
        data: { stockUnits: { increment: refund.units } },
      });
      const remainingUnits = refund.plan.remainingUnits - refund.units;
      await tx.recurringAddonPlan.update({
        where: { id: refund.planId },
        data: {
          remainingUnits,
          status: remainingUnits === 0 ? 'CANCELLED' : 'ACTIVE',
        },
      });
      return tx.recurringAddonRefund.update({
        where: { id: refund.id },
        data: { finalizedAt: new Date() },
      });
    });
  }

  async checkout(userId: string, dto: PaymentCheckoutDto, now = new Date()) {
    const existing = await this.prisma.purchase.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { subscription: true, attempts: true },
    });
    if (existing) {
      if (existing.quoteId !== dto.quoteId)
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Idempotency key belongs to another checkout',
        });
      if (existing.subscription) return this.subscriptionResult(existing.id);
      return this.reconcilePurchase(existing.id);
    }

    const quote = await this.prisma.priceQuote.findFirst({
      where: {
        id: dto.quoteId,
        household: { ownerUserId: userId },
        status: QuoteStatus.ACTIVE,
      },
      include: { household: true },
    });
    if (!quote) throw new NotFoundException('Active quote not found');
    if (now >= quote.expiresAt)
      throw new UnprocessableEntityException({
        code: 'QUOTE_EXPIRED',
        message: 'Quote payment deadline has passed',
      });
    if (
      quote.cashKzt > 0 &&
      (!['local', 'test'].includes(process.env.APP_ENV ?? 'local') ||
        this.provider.code === 'UNCONFIGURED')
    )
      throw new UnprocessableEntityException({
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message: 'Production payment provider is not configured',
      });

    const purchase = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`checkout:${quote.householdId}`}, 0))`;
      const overlapping = await tx.purchase.findFirst({
        where: {
          householdId: quote.householdId,
          status: { in: [PurchaseStatus.PENDING, PurchaseStatus.PAID] },
          OR: [
            { subscription: null },
            {
              subscription: {
                status: {
                  in: [
                    SubscriptionStatus.PENDING_PAYMENT,
                    SubscriptionStatus.ACTIVE,
                    SubscriptionStatus.PAUSED,
                  ],
                },
              },
            },
          ],
        },
      });
      if (overlapping)
        throw new ConflictException({
          code: 'OVERLAPPING_PURCHASE_EXISTS',
          message: 'A payment or active subscription already exists',
        });
      const created = await tx.purchase.create({
        data: {
          householdId: quote.householdId,
          quoteId: quote.id,
          idempotencyKey: dto.idempotencyKey,
          cashKzt: quote.cashKzt,
          bonusKzt: quote.bonusKzt,
        },
      });
      if (quote.cashKzt > 0) {
        await tx.paymentAttempt.create({
          data: {
            purchaseId: created.id,
            idempotencyKey: `payment:${dto.idempotencyKey}`,
            provider: this.provider.code,
            amountKzt: quote.cashKzt,
            status: PaymentAttemptStatus.CREATED,
          },
        });
        await tx.paymentOutbox.create({
          data: {
            aggregateType: 'PURCHASE',
            aggregateId: created.id,
            eventType: 'PAYMENT_CREATE',
            idempotencyKey: `outbox:payment:${dto.idempotencyKey}`,
            payload: {
              purchaseId: created.id,
              amountKzt: quote.cashKzt,
              saveMethod: dto.autoRenew,
            },
          },
        });
      }
      return created;
    });

    if (purchase.cashKzt === 0)
      return this.activatePurchase(purchase.id, userId, dto.autoRenew, now);

    let result: ProviderPayment;
    try {
      result = await this.provider.createPayment({
        idempotencyKey: `payment:${dto.idempotencyKey}`,
        purchaseId: purchase.id,
        amountKzt: purchase.cashKzt,
        returnUrl: dto.returnUrl,
        saveMethod: dto.autoRenew,
      });
    } catch {
      await this.prisma.paymentAttempt.update({
        where: { idempotencyKey: `payment:${dto.idempotencyKey}` },
        data: {
          status: PaymentAttemptStatus.UNKNOWN,
          responseSnapshot: {
            error: 'Provider result is unknown; reconciliation is required',
          },
        },
      });
      return {
        purchaseId: purchase.id,
        status: 'UNKNOWN',
        action: 'WAIT_FOR_RECONCILIATION',
      };
    }
    let paymentMethodId: string | undefined;
    if (result.paymentMethod)
      paymentMethodId = (
        await this.prisma.paymentMethod.upsert({
          where: { providerTokenRef: result.paymentMethod.tokenRef },
          create: {
            householdId: purchase.householdId,
            provider: this.provider.code,
            providerTokenRef: result.paymentMethod.tokenRef,
            mandateRef: result.paymentMethod.mandateRef,
            brand: result.paymentMethod.brand,
            last4: result.paymentMethod.last4,
            expiryMonth: result.paymentMethod.expiryMonth,
            expiryYear: result.paymentMethod.expiryYear,
            mandateActive: dto.autoRenew,
            consentedAt: dto.autoRenew ? now : null,
          },
          update: {
            active: true,
            mandateActive: dto.autoRenew,
            consentedAt: dto.autoRenew ? now : undefined,
          },
        })
      ).id;
    await this.prisma.$transaction([
      this.prisma.paymentAttempt.update({
        where: { idempotencyKey: `payment:${dto.idempotencyKey}` },
        data: {
          providerReference: result.operationId,
          providerEventTime: result.occurredAt,
          paymentMethodId,
          status: providerStatus(result.status),
          authoritativeAt:
            result.status === 'CAPTURED' ? result.occurredAt : null,
          responseSnapshot: result.safeSnapshot as Prisma.InputJsonValue,
        },
      }),
      this.prisma.paymentOutbox.update({
        where: { idempotencyKey: `outbox:payment:${dto.idempotencyKey}` },
        data: {
          status: OutboxStatus.SENT,
          attempts: { increment: 1 },
          processedAt: now,
        },
      }),
    ]);
    if (result.status === 'CAPTURED')
      return this.activatePurchase(
        purchase.id,
        userId,
        dto.autoRenew,
        result.occurredAt,
      );
    return {
      purchaseId: purchase.id,
      status: result.status,
      checkoutUrl: result.checkoutUrl,
    };
  }

  private async activatePurchase(
    purchaseId: string,
    actorUserId: string | null,
    autoRenew: boolean,
    paidAt = new Date(),
  ) {
    const existing = await this.prisma.subscription.findUnique({
      where: { purchaseId },
    });
    if (existing) return this.subscriptionResult(purchaseId);
    const purchase = await this.prisma.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      include: {
        attempts: true,
        quote: { include: { address: true, lines: true } },
      },
    });
    const captured = purchase.attempts.find(
      (item) => item.status === PaymentAttemptStatus.CAPTURED,
    );
    if (purchase.cashKzt > 0 && !captured)
      throw new UnprocessableEntityException({
        code: 'AUTHORITATIVE_PAYMENT_REQUIRED',
        message: 'A return/deep link cannot activate a subscription',
      });
    const input = purchase.quote.inputSnapshot as {
      memberIds: string[];
      cutoffPolicyVersion: number;
    };
    await this.prisma.$transaction(async (tx) => {
      const prior = await tx.subscription.findUnique({ where: { purchaseId } });
      if (prior) return;
      const cutoff = await tx.cutoffPolicy.findUniqueOrThrow({
        where: { version: input.cutoffPolicyVersion },
      });
      const serviceDayCount = purchase.quote.serviceDayCount;
      const end = plusDays(purchase.quote.startDate, serviceDayCount - 1);
      const subscription = await tx.subscription.create({
        data: {
          householdId: purchase.householdId,
          purchaseId,
          cutoffPolicyId: cutoff.id,
          status: SubscriptionStatus.ACTIVE,
          startDate: purchase.quote.startDate,
          currentEndDate: end,
          autoRenew,
          pricingSnapshot: purchase.quote
            .breakdownSnapshot as Prisma.InputJsonValue,
          cutoffSnapshot: {
            version: cutoff.version,
            timezone: cutoff.timezone,
            menuMinutes: cutoff.menuMinutes,
            paymentMinutes: cutoff.paymentMinutes,
            skipMinutes: cutoff.skipMinutes,
            addressMinutes: cutoff.addressMinutes,
            deliveryMinutes: cutoff.deliveryMinutes,
            serviceDaysPerCycle: cutoff.serviceDaysPerCycle,
          },
          participants: {
            create: input.memberIds.map((memberId) => {
              const line = purchase.quote.lines.find(
                (item) => item.memberId === memberId,
              );
              if (!line) throw new Error('Frozen participant price is missing');
              return {
                memberId,
                activeFrom: purchase.quote.startDate,
                activeTo: end,
                priceKzt: line.totalKzt,
                pricingSnapshot: line.details as Prisma.InputJsonValue,
              };
            }),
          },
          serviceDays: {
            create: Array.from({ length: serviceDayCount }, (_, index) => ({
              serviceDate: plusDays(purchase.quote.startDate, index),
              sequence: index + 1,
              events: {
                create: {
                  type: ServiceDayEventType.PLAN,
                  idempotencyKey: `checkout:${purchase.id}:day:${index + 1}`,
                  actorUserId,
                },
              },
            })),
          },
        },
        include: { participants: true, serviceDays: true },
      });
      for (const participant of subscription.participants)
        await tx.dailyOrder.createMany({
          data: subscription.serviceDays.map((serviceDay) => ({
            subscriptionId: subscription.id,
            serviceDayId: serviceDay.id,
            participantId: participant.id,
            memberId: participant.memberId,
            serviceDate: serviceDay.serviceDate,
            addressSnapshot: {
              addressId: purchase.quote.address.id,
              label: purchase.quote.address.label,
              city: purchase.quote.address.city,
              streetAddress: purchase.quote.address.streetAddress,
              apartment: purchase.quote.address.apartment,
              entrance: purchase.quote.address.entrance,
              floor: purchase.quote.address.floor,
              intercom: purchase.quote.address.intercom,
              deliveryInstructions: purchase.quote.address.deliveryInstructions,
              landmarks: purchase.quote.address.landmarks,
              latitude: purchase.quote.address.latitude?.toString(),
              longitude: purchase.quote.address.longitude?.toString(),
              deliverySlotId: purchase.quote.address.deliverySlotId,
              windowStart: purchase.quote.address.windowStart?.toISOString(),
              windowEnd: purchase.quote.address.windowEnd?.toISOString(),
            },
          })),
        });
      await tx.purchase.update({
        where: { id: purchase.id },
        data: { status: PurchaseStatus.PAID, paidAt },
      });
      await tx.priceQuote.update({
        where: { id: purchase.quoteId },
        data: { status: QuoteStatus.ACCEPTED },
      });
      await this.loyalty.settlePurchase(tx, purchase, paidAt);
      await tx.receipt.create({
        data: {
          purchaseId,
          idempotencyKey: `receipt:sale:${purchaseId}`,
          provider: this.fiscalization.code,
        },
      });
      await tx.paymentOutbox.create({
        data: {
          aggregateType: 'PURCHASE',
          aggregateId: purchaseId,
          eventType: 'ISSUE_SALE_RECEIPT',
          idempotencyKey: `outbox:receipt:sale:${purchaseId}`,
          payload: { purchaseId },
        },
      });
      if (autoRenew && captured?.paymentMethodId)
        await this.createRenewalJob(tx, subscription, captured.paymentMethodId);
    });
    await this.issueSaleReceipt(purchaseId);
    return this.subscriptionResult(purchaseId);
  }

  private async createRenewalJob(
    tx: Prisma.TransactionClient,
    subscription: {
      id: string;
      currentEndDate: Date;
      pricingSnapshot: Prisma.JsonValue;
    },
    paymentMethodId: string,
  ) {
    const settings = await tx.paymentSettings.findFirst({
      where: { active: true },
      orderBy: { version: 'desc' },
    });
    if (!settings) throw new Error('Active payment settings are required');
    const pricing = subscription.pricingSnapshot as { cashKzt?: number };
    const schedule = renewalSchedule(
      subscription.currentEndDate,
      settings.renewalNoticeDays,
      settings.businessTimezone,
    );
    await tx.renewalJob.upsert({
      where: {
        subscriptionId_cycleEndDate: {
          subscriptionId: subscription.id,
          cycleEndDate: subscription.currentEndDate,
        },
      },
      create: {
        subscriptionId: subscription.id,
        paymentMethodId,
        cycleEndDate: subscription.currentEndDate,
        expectedChargeAt: schedule.expectedChargeAt,
        notificationDueAt: schedule.notificationDueAt,
        priceKzt: pricing.cashKzt ?? 0,
        pricingSnapshot: subscription.pricingSnapshot as Prisma.InputJsonValue,
        termsVersion: settings.termsVersion,
        maxAttempts: settings.renewalMaxAttempts,
        idempotencyKey: `renewal:${subscription.id}:${dayString(subscription.currentEndDate)}`,
      },
      update: {},
    });
  }

  private subscriptionResult(purchaseId: string) {
    return this.prisma.subscription.findUniqueOrThrow({
      where: { purchaseId },
      include: { participants: true, serviceDays: true },
    });
  }

  async reconcilePurchase(purchaseId: string) {
    const purchase = await this.prisma.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      include: { attempts: true, subscription: true },
    });
    if (purchase.subscription) return this.subscriptionResult(purchase.id);
    if (purchase.cashKzt === 0)
      return this.activatePurchase(purchase.id, null, false);
    const attempt = purchase.attempts[0];
    if (!attempt?.providerReference)
      return { purchaseId, status: 'PENDING', action: 'RETRY_SAME_OPERATION' };
    if (attempt.status === PaymentAttemptStatus.CAPTURED)
      return this.activatePurchase(
        purchase.id,
        null,
        Boolean(attempt.paymentMethodId),
        attempt.authoritativeAt ?? new Date(),
      );
    const providerResult = await this.provider.getPayment(
      attempt.providerReference,
    );
    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: providerStatus(providerResult.status),
        providerEventTime: providerResult.occurredAt,
        authoritativeAt:
          providerResult.status === 'CAPTURED'
            ? providerResult.occurredAt
            : null,
        responseSnapshot: providerResult.safeSnapshot as Prisma.InputJsonValue,
      },
    });
    if (providerResult.status === 'CAPTURED')
      return this.activatePurchase(
        purchase.id,
        null,
        Boolean(attempt.paymentMethodId),
      );
    return { purchaseId, status: providerResult.status };
  }

  async handleWebhook(rawBody: string, signature: string) {
    const event = this.provider.verifyWebhook(rawBody, signature);
    const prior = await this.prisma.providerWebhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: this.provider.code,
          providerEventId: event.eventId,
        },
      },
    });
    if (prior) return { duplicate: true, status: prior.status };
    const stored = await this.prisma.providerWebhookEvent.create({
      data: {
        provider: this.provider.code,
        providerEventId: event.eventId,
        providerOperationId: event.operationId,
        eventType: event.eventType,
        signatureValid: true,
        payloadSnapshot: event.safePayload as Prisma.InputJsonValue,
        providerOccurredAt: event.occurredAt,
      },
    });
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { providerReference: event.operationId },
    });
    if (!event.payment) {
      await this.prisma.providerWebhookEvent.update({
        where: { id: stored.id },
        data: {
          status: ProviderEventStatus.IGNORED,
          processedAt: new Date(),
          resultSnapshot: { reason: 'operation_or_event_not_applicable' },
        },
      });
      return { accepted: true, ignored: true };
    }
    if (!attempt) {
      const addonPlan = await this.prisma.recurringAddonPlan.findUnique({
        where: { providerReference: event.operationId },
      });
      if (!addonPlan) {
        await this.prisma.providerWebhookEvent.update({
          where: { id: stored.id },
          data: {
            status: ProviderEventStatus.IGNORED,
            processedAt: new Date(),
            resultSnapshot: { reason: 'operation_not_found' },
          },
        });
        return { accepted: true, ignored: true };
      }
      if (
        ['CAPTURED', 'FAILED', 'CANCELLED'].includes(addonPlan.paymentStatus) ||
        (addonPlan.providerEventTime &&
          addonPlan.providerEventTime >= event.occurredAt)
      ) {
        await this.prisma.providerWebhookEvent.update({
          where: { id: stored.id },
          data: {
            status: ProviderEventStatus.IGNORED,
            processedAt: new Date(),
            resultSnapshot: { reason: 'addon_payment_terminal_or_stale' },
          },
        });
        return { accepted: true, ignored: true };
      }
      await this.prisma.providerWebhookEvent.update({
        where: { id: stored.id },
        data: {
          status: ProviderEventStatus.PROCESSED,
          processedAt: new Date(),
          resultSnapshot: { addonPaymentStatus: event.payment.status },
        },
      });
      await this.loyalty.recordAddonPayment(addonPlan.id, event.payment);
      return { accepted: true, duplicate: false };
    }
    if (
      attempt.status === PaymentAttemptStatus.CAPTURED ||
      attempt.status === PaymentAttemptStatus.FAILED ||
      attempt.status === PaymentAttemptStatus.CANCELLED
    ) {
      await this.prisma.providerWebhookEvent.update({
        where: { id: stored.id },
        data: {
          status: ProviderEventStatus.IGNORED,
          processedAt: new Date(),
          resultSnapshot: { reason: 'payment_attempt_is_terminal' },
        },
      });
      return { accepted: true, ignored: true };
    }
    if (
      attempt.providerEventTime &&
      attempt.providerEventTime >= event.occurredAt
    ) {
      await this.prisma.providerWebhookEvent.update({
        where: { id: stored.id },
        data: {
          status: ProviderEventStatus.IGNORED,
          processedAt: new Date(),
          resultSnapshot: { reason: 'stale_or_out_of_order' },
        },
      });
      return { accepted: true, ignored: true };
    }
    await this.prisma.$transaction([
      this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: providerStatus(event.payment.status),
          providerEventTime: event.occurredAt,
          authoritativeAt:
            event.payment.status === 'CAPTURED' ? event.occurredAt : null,
          responseSnapshot: event.payment.safeSnapshot as Prisma.InputJsonValue,
        },
      }),
      this.prisma.providerWebhookEvent.update({
        where: { id: stored.id },
        data: {
          status: ProviderEventStatus.PROCESSED,
          processedAt: new Date(),
          resultSnapshot: { paymentStatus: event.payment.status },
        },
      }),
    ]);
    if (event.payment.status === 'CAPTURED')
      await this.activatePurchase(
        attempt.purchaseId,
        null,
        Boolean(attempt.paymentMethodId),
        event.occurredAt,
      );
    return { accepted: true, duplicate: false };
  }

  async paymentHistory(userId: string) {
    return this.prisma.purchase.findMany({
      where: { household: { ownerUserId: userId } },
      orderBy: { createdAt: 'desc' },
      include: {
        attempts: true,
        refunds: true,
        receipts: true,
        quote: { include: { lines: true } },
      },
    });
  }

  paymentMethods(userId: string) {
    return this.prisma.paymentMethod.findMany({
      where: { household: { ownerUserId: userId }, active: true },
      select: {
        id: true,
        provider: true,
        brand: true,
        last4: true,
        expiryMonth: true,
        expiryYear: true,
        mandateActive: true,
        consentedAt: true,
        createdAt: true,
      },
    });
  }

  async requestRefund(userId: string, dto: RefundRequestDto, now = new Date()) {
    const purchase = await this.refundContext(dto.purchaseId, userId);
    const settings = await this.activeSettings();
    const successful = purchase.refunds.filter(
      (item) => item.status === RefundStatus.SUCCEEDED,
    );
    const delivered = purchase.subscription?.serviceDays
      .filter((item) => item.status === ServiceDayStatus.DELIVERED)
      .sort((a, b) => a.serviceDate.getTime() - b.serviceDate.getTime());
    const requestedOn = new Intl.DateTimeFormat('en-CA', {
      timeZone: settings.businessTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const decision = calculateStandardRefund({
      paidCashKzt: purchase.cashKzt,
      paidBonusKzt: purchase.bonusKzt,
      alreadyRefundedCashKzt: successful.reduce(
        (sum, item) => sum + item.cashKzt,
        0,
      ),
      alreadyRefundedBonusKzt: successful.reduce(
        (sum, item) => sum + item.bonusKzt,
        0,
      ),
      paidServiceDays:
        purchase.subscription?.paidServiceDays ??
        purchase.quote.serviceDayCount,
      usedServiceDays: delivered?.length ?? 0,
      firstDeliveredOn: delivered?.[0]
        ? dayString(delivered[0].serviceDate)
        : null,
      requestedOn,
      refundWindowCalendarDays: settings.refundWindowCalendarDays,
    });
    if (!decision.allowed)
      throw new UnprocessableEntityException({
        code: decision.code,
        message: 'Standard voluntary refund is unavailable',
      });
    return this.executeRefund({
      purchase,
      idempotencyKey: dto.idempotencyKey,
      kind: decision.kind,
      cashKzt: decision.cashKzt,
      bonusKzt: decision.bonusKzt,
      restoredServiceDays: decision.unusedServiceDays,
      reason: dto.reason,
      actorUserId: userId,
      policySnapshot: {
        settingsVersion: settings.version,
        requestedOn,
        ...decision,
      },
    });
  }

  async adminRefund(actorUserId: string, dto: AdminRefundDto) {
    const employee = await this.prisma.employee.findFirstOrThrow({
      where: { userId: actorUserId, status: 'ACTIVE' },
    });
    const purchase = await this.refundContext(dto.purchaseId);
    return this.executeRefund({
      purchase,
      idempotencyKey: dto.idempotencyKey,
      kind: RefundKind.ADMIN_COMPENSATION,
      cashKzt: dto.cashKzt,
      bonusKzt: dto.bonusKzt,
      restoredServiceDays: dto.restoredServiceDays,
      reason: dto.reason,
      actorEmployeeId: employee.id,
      policySnapshot: { administrativeException: true },
    });
  }

  private async refundContext(purchaseId: string, ownerUserId?: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: {
        id: purchaseId,
        ...(ownerUserId
          ? { household: { ownerUserId } }
          : { household: undefined }),
      },
      include: {
        refunds: true,
        attempts: true,
        quote: true,
        subscription: { include: { serviceDays: true } },
      },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    return purchase;
  }

  private async executeRefund(input: {
    purchase: Awaited<ReturnType<PaymentService['refundContext']>>;
    idempotencyKey: string;
    kind: RefundKind;
    cashKzt: number;
    bonusKzt: number;
    restoredServiceDays: number;
    reason: string;
    actorUserId?: string;
    actorEmployeeId?: string;
    policySnapshot: Record<string, unknown>;
  }) {
    const prior = await this.prisma.refund.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (prior) {
      if (prior.purchaseId !== input.purchase.id)
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Idempotency key belongs to another refund',
        });
      return prior;
    }
    const attempt = input.purchase.attempts.find(
      (item) => item.status === PaymentAttemptStatus.CAPTURED,
    );
    if (input.cashKzt > 0 && !attempt?.providerReference)
      throw new UnprocessableEntityException('Captured payment is required');

    const refund = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.purchase.id}, 0))`;
      const current = await tx.purchase.findUniqueOrThrow({
        where: { id: input.purchase.id },
        include: { refunds: true },
      });
      const reserved = current.refunds.filter(
        (item) =>
          item.status === RefundStatus.PENDING ||
          item.status === RefundStatus.SUCCEEDED,
      );
      const reservedCash = reserved.reduce(
        (sum, item) => sum + item.cashKzt,
        0,
      );
      const reservedBonus = reserved.reduce(
        (sum, item) => sum + item.bonusKzt,
        0,
      );
      if (
        input.cashKzt < 0 ||
        input.bonusKzt < 0 ||
        input.cashKzt + reservedCash > current.cashKzt ||
        input.bonusKzt + reservedBonus > current.bonusKzt ||
        input.cashKzt + input.bonusKzt === 0
      )
        throw new UnprocessableEntityException({
          code: 'REFUND_AMOUNT_EXCEEDS_REMAINING',
          message: 'Refund cannot exceed captured and unrefunded amounts',
        });
      const created = await tx.refund.create({
        data: {
          purchaseId: input.purchase.id,
          paymentAttemptId: attempt?.id,
          idempotencyKey: input.idempotencyKey,
          kind: input.kind,
          status:
            input.cashKzt > 0 ? RefundStatus.PENDING : RefundStatus.SUCCEEDED,
          cashKzt: input.cashKzt,
          bonusKzt: input.bonusKzt,
          restoredServiceDays: input.restoredServiceDays,
          reason: input.reason,
          actorUserId: input.actorUserId,
          actorEmployeeId: input.actorEmployeeId,
          policySnapshot: input.policySnapshot as Prisma.InputJsonValue,
          authoritativeAt: input.cashKzt === 0 ? new Date() : null,
        },
      });
      if (input.cashKzt > 0)
        await tx.paymentOutbox.create({
          data: {
            aggregateType: 'REFUND',
            aggregateId: created.id,
            eventType: 'PAYMENT_REFUND',
            idempotencyKey: `outbox:refund:${input.idempotencyKey}`,
            payload: {
              refundId: created.id,
              paymentOperationId: attempt?.providerReference,
              amountKzt: input.cashKzt,
            },
          },
        });
      return created;
    });
    if (input.cashKzt > 0) {
      try {
        const result = await this.provider.refund({
          idempotencyKey: `refund:${input.idempotencyKey}`,
          operationId: attempt!.providerReference!,
          amountKzt: input.cashKzt,
          reason: input.reason,
        });
        await this.prisma.$transaction([
          this.prisma.refund.update({
            where: { id: refund.id },
            data: {
              providerRefundReference: result.refundId,
              status:
                result.status === 'SUCCEEDED'
                  ? RefundStatus.SUCCEEDED
                  : result.status === 'FAILED'
                    ? RefundStatus.FAILED
                    : RefundStatus.PENDING,
              authoritativeAt:
                result.status === 'SUCCEEDED' ? result.occurredAt : null,
              providerResponseSnapshot:
                result.safeSnapshot as Prisma.InputJsonValue,
            },
          }),
          this.prisma.paymentOutbox.update({
            where: {
              idempotencyKey: `outbox:refund:${input.idempotencyKey}`,
            },
            data: {
              status:
                result.status === 'SUCCEEDED'
                  ? OutboxStatus.SENT
                  : OutboxStatus.FAILED,
              attempts: { increment: 1 },
              processedAt: result.status === 'SUCCEEDED' ? new Date() : null,
            },
          }),
        ]);
        if (result.status !== 'SUCCEEDED')
          return this.prisma.refund.findUniqueOrThrow({
            where: { id: refund.id },
          });
      } catch {
        return this.prisma.refund.update({
          where: { id: refund.id },
          data: {
            status: RefundStatus.PENDING,
            providerResponseSnapshot: {
              error: 'Provider result unknown; reconcile same refund operation',
            },
          },
        });
      }
    }
    return this.finalizeRefund(refund.id);
  }

  private async finalizeRefund(refundId: string) {
    await this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUniqueOrThrow({
        where: { id: refundId },
        include: {
          purchase: { include: { refunds: true, subscription: true } },
        },
      });
      if (refund.status !== RefundStatus.SUCCEEDED) return;
      if (refund.bonusKzt > 0)
        await tx.bonusLedgerEntry.upsert({
          where: { idempotencyKey: `bonus:refund:${refund.id}` },
          create: {
            householdId: refund.purchase.householdId,
            purchaseId: refund.purchaseId,
            refundId: refund.id,
            idempotencyKey: `bonus:refund:${refund.id}`,
            type: 'CREDIT',
            amountKzt: refund.bonusKzt,
            reason: `Bonus restoration: ${refund.kind}`,
          },
          update: {},
        });
      if (
        refund.kind !== RefundKind.ADMIN_COMPENSATION &&
        refund.purchase.subscription
      ) {
        await tx.subscriptionServiceDay.updateMany({
          where: {
            subscriptionId: refund.purchase.subscription.id,
            status: {
              in: [ServiceDayStatus.PLANNED, ServiceDayStatus.PAUSED],
            },
          },
          data: { status: ServiceDayStatus.CANCELLED },
        });
        await tx.dailyOrder.updateMany({
          where: {
            subscriptionId: refund.purchase.subscription.id,
            status: { in: ['PLANNED', 'PAUSED'] },
          },
          data: { status: 'CANCELLED' },
        });
        await tx.subscription.update({
          where: { id: refund.purchase.subscription.id },
          data: {
            status: SubscriptionStatus.CANCELLED,
            autoRenew: false,
          },
        });
        await tx.renewalJob.updateMany({
          where: { subscriptionId: refund.purchase.subscription.id },
          data: { status: RenewalStatus.CANCELLED },
        });
      }
      const totalCash = refund.purchase.refunds
        .filter((item) => item.status === RefundStatus.SUCCEEDED)
        .reduce((sum, item) => sum + item.cashKzt, 0);
      const totalBonus = refund.purchase.refunds
        .filter((item) => item.status === RefundStatus.SUCCEEDED)
        .reduce((sum, item) => sum + item.bonusKzt, 0);
      const nextPurchaseStatus =
        totalCash >= refund.purchase.cashKzt &&
        totalBonus >= refund.purchase.bonusKzt
          ? PurchaseStatus.REFUNDED
          : PurchaseStatus.PARTIALLY_REFUNDED;
      const nextFinancialStatus =
        nextPurchaseStatus === PurchaseStatus.REFUNDED
          ? ('REFUNDED' as const)
          : ('PARTIALLY_REFUNDED' as const);
      await tx.purchase.update({
        where: { id: refund.purchaseId },
        data: { status: nextPurchaseStatus },
      });
      if (refund.purchase.subscription) {
        const fulfillments = await tx.dailyFulfillment.findMany({
          where: { subscriptionId: refund.purchase.subscription.id },
        });
        for (const fulfillment of fulfillments) {
          const cancelExecution =
            refund.kind !== RefundKind.ADMIN_COMPENSATION &&
            fulfillment.status === 'SCHEDULED';
          await tx.dailyFulfillment.update({
            where: { id: fulfillment.id },
            data: {
              financialStatus: nextFinancialStatus,
              ...(cancelExecution ? { status: 'CANCELLED' as const } : {}),
              version: { increment: 1 },
            },
          });
          await tx.dailyFulfillmentEvent.upsert({
            where: {
              idempotencyKey: `refund:${refund.id}:fulfillment:${fulfillment.id}`,
            },
            create: {
              fulfillmentId: fulfillment.id,
              idempotencyKey: `refund:${refund.id}:fulfillment:${fulfillment.id}`,
              type: 'FINANCIAL_STATE_CHANGED',
              fromStatus: cancelExecution ? fulfillment.status : undefined,
              toStatus: cancelExecution ? 'CANCELLED' : undefined,
              actorType: 'SYSTEM',
              reason: `Refund ${refund.id} finalized without erasing execution history`,
              details: { financialStatus: nextFinancialStatus },
            },
            update: {},
          });
          if (cancelExecution)
            await tx.deliveryJob.updateMany({
              where: { fulfillmentId: fulfillment.id },
              data: {
                status: 'CANCELLED',
                lastError: 'Purchase refund cancelled scheduled fulfillment',
              },
            });
        }
      }
      await this.loyalty.adjustRewardsForRefund(tx, {
        refundId: refund.id,
        purchaseId: refund.purchaseId,
        householdId: refund.purchase.householdId,
        purchaseTotalKzt: refund.purchase.cashKzt + refund.purchase.bonusKzt,
        cumulativeRefundKzt: totalCash + totalBonus,
        fullyRefunded: nextPurchaseStatus === PurchaseStatus.REFUNDED,
      });
      await tx.receipt.upsert({
        where: { idempotencyKey: `receipt:refund:${refund.id}` },
        create: {
          purchaseId: refund.purchaseId,
          refundId: refund.id,
          idempotencyKey: `receipt:refund:${refund.id}`,
          status: ReceiptStatus.REFUND_EXPECTED,
          provider: this.fiscalization.code,
        },
        update: {},
      });
      await tx.paymentOutbox.upsert({
        where: { idempotencyKey: `outbox:receipt:refund:${refund.id}` },
        create: {
          aggregateType: 'REFUND',
          aggregateId: refund.id,
          eventType: 'ISSUE_REFUND_RECEIPT',
          idempotencyKey: `outbox:receipt:refund:${refund.id}`,
          payload: { refundId: refund.id },
        },
        update: {},
      });
    });
    await this.issueRefundReceipt(refundId);
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
  }

  private async issueSaleReceipt(purchaseId: string) {
    const receipt = await this.prisma.receipt.findUniqueOrThrow({
      where: { idempotencyKey: `receipt:sale:${purchaseId}` },
      include: { purchase: true },
    });
    try {
      const document = await this.fiscalization.issueSale({
        idempotencyKey: receipt.idempotencyKey,
        purchaseId,
        amountKzt: receipt.purchase.cashKzt + receipt.purchase.bonusKzt,
      });
      await this.prisma.$transaction([
        this.prisma.receipt.update({
          where: { id: receipt.id },
          data: {
            status: ReceiptStatus.ISSUED,
            fiscal: document.fiscal,
            externalDocumentRef: document.documentId,
            documentUrl: document.documentUrl,
            documentSnapshot: document.safeSnapshot as Prisma.InputJsonValue,
          },
        }),
        this.prisma.paymentOutbox.update({
          where: { idempotencyKey: `outbox:receipt:sale:${purchaseId}` },
          data: { status: OutboxStatus.SENT, processedAt: new Date() },
        }),
      ]);
    } catch {
      await this.prisma.receipt.update({
        where: { id: receipt.id },
        data: { status: ReceiptStatus.FAILED, errorCode: 'PROVIDER_ERROR' },
      });
    }
  }

  private async issueRefundReceipt(refundId: string) {
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { receipts: true },
    });
    const receipt = refund.receipts[0];
    if (!receipt) return;
    try {
      const document = await this.fiscalization.issueRefund({
        idempotencyKey: receipt.idempotencyKey,
        purchaseId: refund.purchaseId,
        refundId,
        amountKzt: refund.cashKzt + refund.bonusKzt,
      });
      await this.prisma.receipt.update({
        where: { id: receipt.id },
        data: {
          status: ReceiptStatus.REFUND_ISSUED,
          fiscal: document.fiscal,
          externalDocumentRef: document.documentId,
          documentUrl: document.documentUrl,
          documentSnapshot: document.safeSnapshot as Prisma.InputJsonValue,
        },
      });
      await this.prisma.paymentOutbox.update({
        where: { idempotencyKey: `outbox:receipt:refund:${refundId}` },
        data: { status: OutboxStatus.SENT, processedAt: new Date() },
      });
    } catch {
      await this.prisma.receipt.update({
        where: { id: receipt.id },
        data: { status: ReceiptStatus.FAILED, errorCode: 'PROVIDER_ERROR' },
      });
    }
  }

  async configureAutoRenew(
    userId: string,
    subscriptionId: string,
    dto: ConfigureAutoRenewDto,
  ) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, household: { ownerUserId: userId } },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');
    if (!dto.enabled) {
      await this.prisma.$transaction([
        this.prisma.subscription.update({
          where: { id: subscriptionId },
          data: { autoRenew: false },
        }),
        this.prisma.renewalJob.updateMany({
          where: {
            subscriptionId,
            status: {
              in: [
                RenewalStatus.SCHEDULED,
                RenewalStatus.NOTICE_SENT,
                RenewalStatus.RETRY_SCHEDULED,
              ],
            },
          },
          data: { status: RenewalStatus.CANCELLED },
        }),
      ]);
      return { id: subscriptionId, autoRenew: false };
    }
    if (!dto.termsAccepted || !dto.paymentMethodId)
      throw new UnprocessableEntityException({
        code: 'RENEWAL_CONSENT_REQUIRED',
        message: 'Explicit terms acceptance and a payment method are required',
      });
    const method = await this.prisma.paymentMethod.findFirst({
      where: {
        id: dto.paymentMethodId,
        householdId: subscription.householdId,
        active: true,
        mandateActive: true,
      },
    });
    if (!method)
      throw new UnprocessableEntityException({
        code: 'ACTIVE_MANDATE_REQUIRED',
        message: 'An active provider mandate is required',
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: { autoRenew: true },
      });
      await this.createRenewalJob(tx, subscription, method.id);
    });
    return this.prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { renewalJobs: true },
    });
  }

  async registerReceipt(actorUserId: string, dto: RegisterReceiptDto) {
    const employee = await this.prisma.employee.findFirstOrThrow({
      where: { userId: actorUserId, status: 'ACTIVE' },
    });
    const receipt = await this.prisma.receipt.upsert({
      where: { idempotencyKey: dto.idempotencyKey },
      create: {
        purchaseId: dto.purchaseId,
        refundId: dto.refundId,
        idempotencyKey: dto.idempotencyKey,
        status: dto.refundId
          ? ReceiptStatus.REFUND_ISSUED
          : ReceiptStatus.ISSUED,
        fiscal: true,
        provider: 'MANUAL_REGISTERED',
        externalDocumentRef: dto.externalDocumentRef,
        documentUrl: dto.documentUrl,
        documentSnapshot: { registeredByEmployeeId: employee.id },
      },
      update: {},
    });
    await this.prisma.auditLog.create({
      data: {
        actorEmployeeId: employee.id,
        action: 'fiscal_document.register',
        entityType: 'Receipt',
        entityId: receipt.id,
        newValues: {
          externalDocumentRef: receipt.externalDocumentRef,
          fiscal: true,
        },
        reason: 'Manual fiscal document registration',
        requestId: dto.idempotencyKey,
      },
    });
    return receipt;
  }

  async runMaintenance(now = new Date()) {
    const externalOutbox = await this.prisma.paymentOutbox.findMany({
      where: {
        status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] },
        nextAttemptAt: { lte: now },
        eventType: {
          in: [
            'PAYMENT_CREATE',
            'PAYMENT_REFUND',
            'ISSUE_SALE_RECEIPT',
            'ISSUE_REFUND_RECEIPT',
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const item of externalOutbox) {
      try {
        if (item.eventType === 'PAYMENT_CREATE')
          await this.retryPaymentOutbox(item.aggregateId);
        else if (item.eventType === 'PAYMENT_REFUND')
          await this.retryRefundOutbox(item.aggregateId);
        else if (item.eventType === 'ISSUE_SALE_RECEIPT')
          await this.issueSaleReceipt(item.aggregateId);
        else if (item.eventType === 'ISSUE_REFUND_RECEIPT')
          await this.issueRefundReceipt(item.aggregateId);
      } catch (error) {
        await this.prisma.paymentOutbox.update({
          where: { id: item.id },
          data: {
            status: OutboxStatus.FAILED,
            attempts: { increment: 1 },
            lastError:
              error instanceof Error ? error.message.slice(0, 1000) : 'error',
            nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
          },
        });
      }
    }
    const unresolved = await this.prisma.paymentAttempt.findMany({
      where: {
        status: {
          in: [PaymentAttemptStatus.PENDING, PaymentAttemptStatus.UNKNOWN],
        },
        providerReference: { not: null },
      },
      select: { purchaseId: true },
      take: 50,
    });
    for (const attempt of unresolved)
      await this.reconcilePurchase(attempt.purchaseId);
    const unresolvedAddons = await this.prisma.recurringAddonPlan.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        paymentStatus: {
          in: [
            PaymentAttemptStatus.CREATED,
            PaymentAttemptStatus.PENDING,
            PaymentAttemptStatus.REQUIRES_ACTION,
            PaymentAttemptStatus.UNKNOWN,
          ],
        },
      },
      take: 50,
    });
    for (const plan of unresolvedAddons) {
      try {
        const result = plan.providerReference
          ? await this.provider.getPayment(plan.providerReference)
          : await this.provider.createPayment({
              idempotencyKey: `addon-payment:${plan.idempotencyKey}`,
              purchaseId: plan.id,
              amountKzt: plan.cashKzt,
              saveMethod: false,
            });
        await this.loyalty.recordAddonPayment(plan.id, result);
      } catch {
        await this.prisma.recurringAddonPlan.update({
          where: { id: plan.id },
          data: { paymentStatus: PaymentAttemptStatus.UNKNOWN },
        });
      }
    }
    const unresolvedAddonRefunds =
      await this.prisma.recurringAddonRefund.findMany({
        where: { status: RefundStatus.PENDING },
        include: { plan: true },
        take: 50,
      });
    for (const refund of unresolvedAddonRefunds) {
      if (!refund.plan.providerReference) continue;
      try {
        const result = await this.provider.refund({
          idempotencyKey: `addon-refund:${refund.idempotencyKey}`,
          operationId: refund.plan.providerReference,
          amountKzt: refund.cashKzt,
          reason: refund.reason,
        });
        await this.prisma.recurringAddonRefund.update({
          where: { id: refund.id },
          data: {
            providerRefundReference: result.refundId,
            status:
              result.status === 'SUCCEEDED'
                ? RefundStatus.SUCCEEDED
                : result.status === 'FAILED'
                  ? RefundStatus.FAILED
                  : RefundStatus.PENDING,
            providerResponseSnapshot:
              result.safeSnapshot as Prisma.InputJsonValue,
          },
        });
        if (result.status === 'SUCCEEDED')
          await this.finalizeRecurringAddonRefund(refund.id);
      } catch {
        // Keep PENDING: the next maintenance run repeats the same provider key.
      }
    }
    const noticeJobs = await this.prisma.renewalJob.findMany({
      where: {
        status: RenewalStatus.SCHEDULED,
        notificationDueAt: { lte: now },
      },
      take: 100,
    });
    for (const job of noticeJobs)
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.renewalJob.updateMany({
          where: { id: job.id, status: RenewalStatus.SCHEDULED },
          data: { status: RenewalStatus.NOTICE_SENT, notifiedAt: now },
        });
        if (!claimed.count) return;
        await tx.paymentOutbox.upsert({
          where: { idempotencyKey: `outbox:renewal-notice:${job.id}` },
          create: {
            aggregateType: 'RENEWAL',
            aggregateId: job.id,
            eventType: 'RENEWAL_NOTICE',
            idempotencyKey: `outbox:renewal-notice:${job.id}`,
            payload: {
              subscriptionId: job.subscriptionId,
              expectedChargeAt: job.expectedChargeAt.toISOString(),
              priceKzt: job.priceKzt,
              termsVersion: job.termsVersion,
            },
          },
          update: {},
        });
      });
    const due = await this.prisma.renewalJob.findMany({
      where: {
        OR: [
          {
            status: RenewalStatus.NOTICE_SENT,
            expectedChargeAt: { lte: now },
          },
          {
            status: RenewalStatus.RETRY_SCHEDULED,
            nextAttemptAt: { lte: now },
          },
          { status: RenewalStatus.PAYMENT_PENDING },
        ],
      },
      take: 50,
    });
    const results = [];
    for (const job of due) results.push(await this.processRenewal(job.id, now));
    return {
      externalOperations: externalOutbox.length,
      reconciledPayments: unresolved.length,
      reconciledAddonPayments: unresolvedAddons.length,
      reconciledAddonRefunds: unresolvedAddonRefunds.length,
      notices: noticeJobs.length,
      renewals: results,
    };
  }

  private async retryPaymentOutbox(purchaseId: string) {
    const purchase = await this.prisma.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      include: { attempts: true },
    });
    const attempt = purchase.attempts[0];
    if (!attempt) throw new Error('Payment attempt is missing');
    if (attempt.status === PaymentAttemptStatus.CAPTURED) {
      await this.activatePurchase(
        purchaseId,
        null,
        Boolean(attempt.paymentMethodId),
        attempt.authoritativeAt ?? new Date(),
      );
      return;
    }
    const outbox = await this.prisma.paymentOutbox.findUniqueOrThrow({
      where: { idempotencyKey: `outbox:${attempt.idempotencyKey}` },
    });
    const payload = outbox.payload as { saveMethod?: boolean };
    const result = attempt.providerReference
      ? await this.provider.getPayment(attempt.providerReference)
      : await this.provider.createPayment({
          idempotencyKey: attempt.idempotencyKey,
          purchaseId,
          amountKzt: attempt.amountKzt,
          saveMethod: Boolean(payload.saveMethod),
        });
    let paymentMethodId = attempt.paymentMethodId ?? undefined;
    if (!paymentMethodId && result.paymentMethod)
      paymentMethodId = (
        await this.prisma.paymentMethod.upsert({
          where: { providerTokenRef: result.paymentMethod.tokenRef },
          create: {
            householdId: purchase.householdId,
            provider: this.provider.code,
            providerTokenRef: result.paymentMethod.tokenRef,
            mandateRef: result.paymentMethod.mandateRef,
            brand: result.paymentMethod.brand,
            last4: result.paymentMethod.last4,
            expiryMonth: result.paymentMethod.expiryMonth,
            expiryYear: result.paymentMethod.expiryYear,
            mandateActive: Boolean(payload.saveMethod),
            consentedAt: payload.saveMethod ? new Date() : null,
          },
          update: {},
        })
      ).id;
    await this.prisma.$transaction([
      this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          providerReference: result.operationId,
          providerEventTime: result.occurredAt,
          paymentMethodId,
          status: providerStatus(result.status),
          authoritativeAt:
            result.status === 'CAPTURED' ? result.occurredAt : null,
          responseSnapshot: result.safeSnapshot as Prisma.InputJsonValue,
        },
      }),
      this.prisma.paymentOutbox.update({
        where: { id: outbox.id },
        data: {
          status: OutboxStatus.SENT,
          attempts: { increment: 1 },
          processedAt: new Date(),
          lastError: null,
        },
      }),
    ]);
    if (result.status === 'CAPTURED')
      await this.activatePurchase(
        purchaseId,
        null,
        Boolean(payload.saveMethod),
        result.occurredAt,
      );
  }

  private async retryRefundOutbox(refundId: string) {
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { paymentAttempt: true },
    });
    if (refund.status === RefundStatus.SUCCEEDED) {
      await this.finalizeRefund(refund.id);
      return;
    }
    if (!refund.paymentAttempt?.providerReference)
      throw new Error('Refund payment operation is missing');
    const result = await this.provider.refund({
      idempotencyKey: `refund:${refund.idempotencyKey}`,
      operationId: refund.paymentAttempt.providerReference,
      amountKzt: refund.cashKzt,
      reason: refund.reason,
    });
    await this.prisma.$transaction([
      this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          providerRefundReference: result.refundId,
          status:
            result.status === 'SUCCEEDED'
              ? RefundStatus.SUCCEEDED
              : result.status === 'FAILED'
                ? RefundStatus.FAILED
                : RefundStatus.PENDING,
          authoritativeAt:
            result.status === 'SUCCEEDED' ? result.occurredAt : null,
          providerResponseSnapshot:
            result.safeSnapshot as Prisma.InputJsonValue,
        },
      }),
      this.prisma.paymentOutbox.update({
        where: { idempotencyKey: `outbox:refund:${refund.idempotencyKey}` },
        data: {
          status:
            result.status === 'SUCCEEDED'
              ? OutboxStatus.SENT
              : OutboxStatus.FAILED,
          attempts: { increment: 1 },
          processedAt: result.status === 'SUCCEEDED' ? new Date() : null,
        },
      }),
    ]);
    if (result.status === 'SUCCEEDED') await this.finalizeRefund(refund.id);
  }

  async processRenewal(jobId: string, now = new Date()) {
    const job = await this.prisma.renewalJob.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        paymentMethod: true,
        subscription: {
          include: {
            participants: true,
            serviceDays: true,
            purchase: {
              include: { quote: { include: { lines: true, address: true } } },
            },
          },
        },
      },
    });
    if (job.status === RenewalStatus.SUCCEEDED) return job;
    if (
      !job.subscription.autoRenew ||
      !job.paymentMethod.active ||
      !job.paymentMethod.mandateActive ||
      dayString(job.subscription.currentEndDate) !== dayString(job.cycleEndDate)
    ) {
      return this.prisma.renewalJob.update({
        where: { id: job.id },
        data: { status: RenewalStatus.ACTION_REQUIRED },
      });
    }
    const settings = await this.activeSettings();
    const minimumNotice = settings.renewalNoticeDays * DAY;
    if (
      !job.notifiedAt ||
      job.expectedChargeAt.getTime() - job.notifiedAt.getTime() < minimumNotice
    ) {
      const postponed = new Date(
        (job.notifiedAt ?? now).getTime() + minimumNotice,
      );
      return this.prisma.renewalJob.update({
        where: { id: job.id },
        data: {
          expectedChargeAt: postponed,
          nextAttemptAt: postponed,
          status: RenewalStatus.NOTICE_SENT,
        },
      });
    }

    const original = job.subscription.purchase.quote;
    const startDate = plusDays(job.subscription.currentEndDate, 1);
    const purchaseKey = `renewal:${job.id}`;
    let purchase = await this.prisma.purchase.findUnique({
      where: { idempotencyKey: purchaseKey },
      include: { attempts: true },
    });
    if (!purchase)
      purchase = await this.prisma.$transaction(async (tx) => {
        const quote = await tx.priceQuote.create({
          data: {
            householdId: job.subscription.householdId,
            addressId: original.addressId,
            pricingRuleSetId: original.pricingRuleSetId,
            startDate,
            serviceDayCount: original.serviceDayCount,
            subtotalKzt: job.priceKzt,
            discountKzt: 0,
            bonusKzt: 0,
            cashKzt: job.priceKzt,
            inputSnapshot: {
              renewalJobId: job.id,
              memberIds: job.subscription.participants
                .filter((item) => item.memberId)
                .map((item) => item.memberId),
              startDate: dayString(startDate),
              cutoffPolicyVersion: (
                job.subscription.cutoffSnapshot as { version: number }
              ).version,
            },
            breakdownSnapshot: job.pricingSnapshot as Prisma.InputJsonValue,
            expiresAt: job.expectedChargeAt,
            lines: {
              create: original.lines.map((line) => ({
                memberId: line.memberId,
                kind: line.kind,
                description: line.description,
                quantity: line.quantity,
                unitKzt: line.unitKzt,
                totalKzt: line.totalKzt,
                serviceDate: line.serviceDate,
                details: line.details as Prisma.InputJsonValue,
              })),
            },
          },
        });
        const created = await tx.purchase.create({
          data: {
            householdId: job.subscription.householdId,
            quoteId: quote.id,
            idempotencyKey: purchaseKey,
            cashKzt: job.priceKzt,
            bonusKzt: 0,
            renewalOfSubscriptionId: job.subscriptionId,
            attempts: {
              create: {
                idempotencyKey: `payment:${purchaseKey}`,
                provider: this.provider.code,
                paymentMethodId: job.paymentMethodId,
                amountKzt: job.priceKzt,
              },
            },
          },
          include: { attempts: true },
        });
        await tx.renewalJob.update({
          where: { id: job.id },
          data: { status: RenewalStatus.PAYMENT_PENDING },
        });
        return created;
      });

    const attempt = purchase.attempts[0];
    if (attempt.status === PaymentAttemptStatus.CAPTURED)
      return this.finalizeRenewal(
        job.id,
        purchase.id,
        attempt.authoritativeAt ?? now,
      );
    let result: ProviderPayment;
    if (attempt.providerReference) {
      result = await this.provider.getPayment(attempt.providerReference);
    } else {
      result = await this.provider.createPayment({
        idempotencyKey: attempt.idempotencyKey,
        purchaseId: purchase.id,
        amountKzt: purchase.cashKzt,
        saveMethod: false,
        paymentMethodTokenRef: job.paymentMethod.providerTokenRef,
      });
    }
    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        providerReference: result.operationId,
        providerEventTime: result.occurredAt,
        status: providerStatus(result.status),
        authoritativeAt:
          result.status === 'CAPTURED' ? result.occurredAt : null,
        responseSnapshot: result.safeSnapshot as Prisma.InputJsonValue,
      },
    });
    if (result.status !== 'CAPTURED') {
      const attempts = job.attempts + 1;
      return this.prisma.renewalJob.update({
        where: { id: job.id },
        data: {
          attempts,
          status:
            attempts >= job.maxAttempts
              ? RenewalStatus.ACTION_REQUIRED
              : RenewalStatus.RETRY_SCHEDULED,
          nextAttemptAt:
            attempts >= job.maxAttempts
              ? null
              : new Date(
                  now.getTime() + settings.renewalRetryDelayHours * 3_600_000,
                ),
        },
      });
    }
    return this.finalizeRenewal(job.id, purchase.id, result.occurredAt);
  }

  private async finalizeRenewal(
    jobId: string,
    purchaseId: string,
    paidAt: Date,
  ) {
    const completed = await this.prisma.$transaction(async (tx) => {
      const job = await tx.renewalJob.findUniqueOrThrow({
        where: { id: jobId },
        include: {
          subscription: {
            include: {
              participants: true,
              serviceDays: { orderBy: { sequence: 'desc' }, take: 1 },
              purchase: { include: { quote: { include: { address: true } } } },
            },
          },
        },
      });
      if (job.status === RenewalStatus.SUCCEEDED) return job;
      const oldEnd = job.subscription.currentEndDate;
      if (dayString(oldEnd) !== dayString(job.cycleEndDate)) {
        await tx.renewalJob.update({
          where: { id: job.id },
          data: { status: RenewalStatus.ACTION_REQUIRED },
        });
        throw new ConflictException(
          'Subscription dates changed during renewal',
        );
      }
      const firstSequence =
        (job.subscription.serviceDays[0]?.sequence ?? 0) + 1;
      const days = [];
      const serviceDayCount = job.subscription.purchase.quote.serviceDayCount;
      for (let index = 0; index < serviceDayCount; index++)
        days.push(
          await tx.subscriptionServiceDay.create({
            data: {
              subscriptionId: job.subscriptionId,
              serviceDate: plusDays(oldEnd, index + 1),
              sequence: firstSequence + index,
              events: {
                create: {
                  type: ServiceDayEventType.PLAN,
                  idempotencyKey: `renewal:${job.id}:day:${index + 1}`,
                  reason: `Paid renewal purchase ${purchaseId}`,
                },
              },
            },
          }),
        );
      const address = job.subscription.purchase.quote.address;
      for (const participant of job.subscription.participants) {
        for (const serviceDay of days)
          await tx.dailyOrder.create({
            data: {
              subscriptionId: job.subscriptionId,
              serviceDayId: serviceDay.id,
              participantId: participant.id,
              memberId: participant.memberId,
              serviceDate: serviceDay.serviceDate,
              addressSnapshot: {
                addressId: address.id,
                label: address.label,
                city: address.city,
                streetAddress: address.streetAddress,
                apartment: address.apartment,
                entrance: address.entrance,
                floor: address.floor,
                intercom: address.intercom,
                deliveryInstructions: address.deliveryInstructions,
                landmarks: address.landmarks,
                latitude: address.latitude?.toString(),
                longitude: address.longitude?.toString(),
                deliverySlotId: address.deliverySlotId,
              },
            },
          });
        await tx.subscriptionParticipant.update({
          where: { id: participant.id },
          data: { activeTo: plusDays(oldEnd, serviceDayCount) },
        });
      }
      const subscription = await tx.subscription.update({
        where: { id: job.subscriptionId },
        data: {
          currentEndDate: plusDays(oldEnd, serviceDayCount),
          paidServiceDays: { increment: serviceDayCount },
        },
      });
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: PurchaseStatus.PAID, paidAt },
      });
      const purchase = await tx.purchase.findUniqueOrThrow({
        where: { id: purchaseId },
      });
      await tx.priceQuote.update({
        where: { id: purchase.quoteId },
        data: { status: QuoteStatus.ACCEPTED },
      });
      await tx.renewalJob.update({
        where: { id: job.id },
        data: { status: RenewalStatus.SUCCEEDED, attempts: { increment: 1 } },
      });
      await tx.receipt.create({
        data: {
          purchaseId,
          idempotencyKey: `receipt:sale:${purchaseId}`,
          provider: this.fiscalization.code,
        },
      });
      await tx.paymentOutbox.create({
        data: {
          aggregateType: 'PURCHASE',
          aggregateId: purchaseId,
          eventType: 'ISSUE_SALE_RECEIPT',
          idempotencyKey: `outbox:receipt:sale:${purchaseId}`,
          payload: { purchaseId },
        },
      });
      await this.createRenewalJob(tx, subscription, job.paymentMethodId);
      return job;
    });
    await this.issueSaleReceipt(purchaseId);
    return completed;
  }

  private activeSettings() {
    return this.prisma.paymentSettings.findFirstOrThrow({
      where: { active: true },
      orderBy: { version: 'desc' },
    });
  }
}
