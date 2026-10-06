import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BusinessRuleStatus,
  ServiceDayEventType,
  ServiceDayStatus,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AdminClubTierDto,
  AdminFreeDayDto,
  AdminLoyaltySettingsDto,
  AdminManualSubscriptionDto,
  AdminPromoCodeDto,
  AdminReferralTierDto,
  AdminSkipExceptionDto,
} from './admin.dto.js';

const DAY = 86400000;
const dateString = (value: Date) => value.toISOString().slice(0, 10);

@Injectable()
export class AdminOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async employee(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  private async auditConfig(
    tx: Prisma.TransactionClient,
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    values: Prisma.InputJsonValue,
  ) {
    const employee = await this.employee(userId);
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        actorEmployeeId: employee.id,
        action,
        entityType,
        entityId,
        newValues: values,
        reason: 'Stage 4 business configuration',
        requestId: randomUUID(),
      },
    });
  }

  createLoyaltySettings(userId: string, dto: AdminLoyaltySettingsDto) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.loyaltySettings.create({
        data: {
          ...dto,
          bonusKztPerUnit: 1,
          welcomeBase: 'CASH_AFTER_DISCOUNTS',
        },
      });
      await this.auditConfig(
        tx,
        userId,
        'LOYALTY_SETTINGS_CREATED',
        'LoyaltySettings',
        result.id,
        result as unknown as Prisma.InputJsonValue,
      );
      return result;
    });
  }

  upsertPromo(userId: string, dto: AdminPromoCodeDto) {
    const code = dto.code.trim().toUpperCase();
    const values = {
      mechanic: dto.mechanic,
      value: dto.value,
      status: dto.status,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
      validTo: dto.validTo ? new Date(dto.validTo) : null,
      totalUseLimit: dto.totalUseLimit,
      perHouseholdUseLimit: dto.perHouseholdUseLimit,
      firstSubscriptionOnly: dto.firstSubscriptionOnly,
      minSubtotalKzt: dto.minSubtotalKzt,
      applicableOperations: ['SUBSCRIPTION'],
      applicableProductCodes: [],
      compatibleCodes: [],
    } as const;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.promoCode.upsert({
        where: { code },
        create: { code, ...values },
        update: values,
      });
      await this.auditConfig(
        tx,
        userId,
        'PROMO_CONFIGURED',
        'PromoCode',
        result.id,
        result as unknown as Prisma.InputJsonValue,
      );
      return result;
    });
  }

  upsertReferralTier(userId: string, dto: AdminReferralTierDto) {
    const code = dto.code.trim().toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.referralTier.upsert({
        where: { code },
        create: {
          ...dto,
          code,
          rewardBase: 'INVITEE_CASH_AFTER_DISCOUNTS',
        },
        update: dto,
      });
      await this.auditConfig(
        tx,
        userId,
        'REFERRAL_TIER_CONFIGURED',
        'ReferralTier',
        result.id,
        result as unknown as Prisma.InputJsonValue,
      );
      return result;
    });
  }

  upsertClubTier(userId: string, dto: AdminClubTierDto) {
    const code = dto.code.trim().toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.clubTier.upsert({
        where: { code },
        create: { ...dto, code, benefits: { configuredInAdmin: true } },
        update: dto,
      });
      await this.auditConfig(
        tx,
        userId,
        'CLUB_TIER_CONFIGURED',
        'ClubTier',
        result.id,
        result as unknown as Prisma.InputJsonValue,
      );
      return result;
    });
  }

  async skipException(
    userId: string,
    subscriptionId: string,
    dto: AdminSkipExceptionDto,
  ) {
    const prior = await this.prisma.serviceDayEvent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { serviceDay: true },
    });
    if (prior) return prior.serviceDay;
    const [employee, subscription] = await Promise.all([
      this.employee(userId),
      this.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          serviceDays: {
            orderBy: { sequence: 'asc' },
            include: { orders: { include: { lines: true } } },
          },
        },
      }),
    ]);
    if (!subscription) throw new NotFoundException('Subscription not found');
    const target = subscription.serviceDays.find(
      (item) => dateString(item.serviceDate) === dto.serviceDate,
    );
    if (!target || target.status !== ServiceDayStatus.PLANNED)
      throw new UnprocessableEntityException(
        'Only a planned day can be skipped',
      );
    const extension = new Date(subscription.currentEndDate.getTime() + DAY);
    return this.prisma.$transaction(async (tx) => {
      await tx.subscriptionServiceDay.update({
        where: { id: target.id },
        data: { status: ServiceDayStatus.SKIPPED, version: { increment: 1 } },
      });
      await tx.dailyOrder.updateMany({
        where: { serviceDayId: target.id },
        data: { status: 'SKIPPED' },
      });
      await tx.serviceDayEvent.create({
        data: {
          serviceDayId: target.id,
          type: ServiceDayEventType.TRANSFER,
          idempotencyKey: dto.idempotencyKey,
          fromDate: target.serviceDate,
          toDate: extension,
          reason: dto.reason,
          actorUserId: userId,
        },
      });
      const replacement = await tx.subscriptionServiceDay.create({
        data: {
          subscriptionId,
          serviceDate: extension,
          sequence: subscription.serviceDays.length + 1,
          transferredFrom: target.serviceDate,
          events: {
            create: {
              type: ServiceDayEventType.PLAN,
              idempotencyKey: `${dto.idempotencyKey}:replacement`,
              reason: dto.reason,
              actorUserId: userId,
            },
          },
        },
      });
      for (const order of target.orders)
        await tx.dailyOrder.create({
          data: {
            subscriptionId,
            serviceDayId: replacement.id,
            participantId: order.participantId,
            memberId: order.memberId,
            serviceDate: extension,
            addressSnapshot: order.addressSnapshot as Prisma.InputJsonValue,
            lines: {
              create: order.lines.map((line) => ({
                mealType: line.mealType,
                mealSnapshot: line.mealSnapshot as Prisma.InputJsonValue,
                recipeSnapshot: line.recipeSnapshot as Prisma.InputJsonValue,
                modificationSnapshot:
                  line.modificationSnapshot as Prisma.InputJsonValue,
                nutritionSnapshot:
                  line.nutritionSnapshot as Prisma.InputJsonValue,
                priceSnapshot: line.priceSnapshot as Prisma.InputJsonValue,
              })),
            },
          },
        });
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: { currentEndDate: extension },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorEmployeeId: employee.id,
          action: 'SUBSCRIPTION_SKIP_CUTOFF_EXCEPTION',
          entityType: 'Subscription',
          entityId: subscriptionId,
          oldValues: { serviceDate: dto.serviceDate, status: target.status },
          newValues: {
            serviceDate: dto.serviceDate,
            status: 'SKIPPED',
            transferredTo: dateString(extension),
            recalculatedEndDate: dateString(extension),
          },
          reason: dto.reason,
          requestId: randomUUID(),
        },
      });
      await tx.staffTask.create({
        data: {
          type: 'CUSTOMER_NOTIFICATION_REQUIRED',
          details: {
            householdId: subscription.householdId,
            subscriptionId,
            event: 'SKIP_CUTOFF_EXCEPTION',
            serviceDate: dto.serviceDate,
            replacementDate: dateString(extension),
          },
        },
      });
      return replacement;
    });
  }

  async freeDay(userId: string, subscriptionId: string, dto: AdminFreeDayDto) {
    const prior = await this.prisma.serviceDayEvent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { serviceDay: true },
    });
    if (prior) return prior.serviceDay;
    const [employee, subscription] = await Promise.all([
      this.employee(userId),
      this.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          serviceDays: true,
          participants: true,
          purchase: { include: { quote: { include: { address: true } } } },
        },
      }),
    ]);
    if (!subscription) throw new NotFoundException('Subscription not found');
    const serviceDate = new Date(subscription.currentEndDate.getTime() + DAY);
    return this.prisma.$transaction(async (tx) => {
      const day = await tx.subscriptionServiceDay.create({
        data: {
          subscriptionId,
          serviceDate,
          sequence: subscription.serviceDays.length + 1,
          events: {
            create: {
              type: ServiceDayEventType.COMPENSATE,
              idempotencyKey: dto.idempotencyKey,
              reason: dto.reason,
              actorUserId: userId,
            },
          },
        },
      });
      const address = subscription.purchase.quote.address;
      await tx.dailyOrder.createMany({
        data: subscription.participants.map((participant) => ({
          subscriptionId,
          serviceDayId: day.id,
          participantId: participant.id,
          memberId: participant.memberId,
          serviceDate,
          addressSnapshot: {
            addressId: address.id,
            city: address.city,
            streetAddress: address.streetAddress,
            apartment: address.apartment,
            windowStart: address.windowStart?.toISOString(),
            windowEnd: address.windowEnd?.toISOString(),
          },
        })),
      });
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: { currentEndDate: serviceDate },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorEmployeeId: employee.id,
          action: 'SUBSCRIPTION_FREE_SERVICE_DAY',
          entityType: 'Subscription',
          entityId: subscriptionId,
          newValues: {
            serviceDate: dateString(serviceDate),
            financialEffectKzt: 0,
            paidServiceDaysUnchanged: subscription.paidServiceDays,
          },
          reason: dto.reason,
          requestId: randomUUID(),
        },
      });
      await tx.staffTask.create({
        data: {
          type: 'CUSTOMER_NOTIFICATION_REQUIRED',
          details: {
            householdId: subscription.householdId,
            subscriptionId,
            event: 'FREE_SERVICE_DAY',
            serviceDate: dateString(serviceDate),
          },
        },
      });
      return day;
    });
  }

  async manualSubscription(
    userId: string,
    householdId: string,
    dto: AdminManualSubscriptionDto,
    requestId: string,
  ) {
    const prior = await this.prisma.purchase.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { subscription: true },
    });
    if (prior) return prior.subscription;
    const requiredStatus =
      process.env.APP_ENV === 'production'
        ? BusinessRuleStatus.ACTIVE
        : BusinessRuleStatus.DEMO;
    const [employee, household, cutoff, pricing] = await Promise.all([
      this.employee(userId),
      this.prisma.household.findUnique({
        where: { id: householdId },
        include: {
          addresses: { where: { id: dto.addressId, deletedAt: null } },
          members: {
            where: {
              id: { in: dto.memberIds },
              deletedAt: null,
              status: 'ACTIVE',
            },
          },
        },
      }),
      this.prisma.cutoffPolicy.findFirst({
        where: { status: requiredStatus },
        orderBy: { version: 'desc' },
      }),
      this.prisma.pricingRuleSet.findFirst({
        where: { status: requiredStatus },
        orderBy: { version: 'desc' },
      }),
    ]);
    if (!household || household.addresses.length !== 1)
      throw new NotFoundException('Household or address not found');
    if (household.members.length !== dto.memberIds.length)
      throw new UnprocessableEntityException(
        'Every member must belong to this household',
      );
    if (!cutoff || !pricing)
      throw new UnprocessableEntityException(
        'Active pricing and cutoff policy are required',
      );
    const startDate = new Date(`${dto.startDate}T00:00:00.000Z`);
    const endDate = new Date(startDate.getTime() + (dto.serviceDays - 1) * DAY);
    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.priceQuote.create({
        data: {
          householdId,
          addressId: dto.addressId,
          pricingRuleSetId: pricing.id,
          startDate,
          serviceDayCount: dto.serviceDays,
          subtotalKzt: 0,
          discountKzt: 0,
          bonusKzt: 0,
          cashKzt: 0,
          inputSnapshot: {
            source: 'STAFF_MANUAL',
            mode: dto.mode,
            memberIds: dto.memberIds,
            actorEmployeeId: employee.id,
            reason: dto.reason,
          },
          breakdownSnapshot: {
            basis:
              dto.mode === 'COMPLIMENTARY'
                ? 'COMPLIMENTARY_GRANT'
                : 'PENDING_MANUAL_ORDER',
            noPaymentClaimed: true,
          },
          status: dto.mode === 'COMPLIMENTARY' ? 'ACCEPTED' : 'ACTIVE',
          expiresAt: new Date(Date.now() + DAY),
          lines: {
            create: household.members.map((member) => ({
              memberId: member.id,
              kind:
                dto.mode === 'COMPLIMENTARY'
                  ? 'COMPLIMENTARY_MEMBER'
                  : 'PENDING_MEMBER',
              description: `${member.firstName}: ${dto.serviceDays} service day(s)`,
              unitKzt: 0,
              totalKzt: 0,
              details: { reason: dto.reason },
            })),
          },
        },
      });
      const purchase = await tx.purchase.create({
        data: {
          householdId,
          quoteId: quote.id,
          idempotencyKey: dto.idempotencyKey,
          status: dto.mode,
          cashKzt: 0,
          bonusKzt: 0,
        },
      });
      const subscription = await tx.subscription.create({
        data: {
          householdId,
          purchaseId: purchase.id,
          cutoffPolicyId: cutoff.id,
          status: dto.mode === 'COMPLIMENTARY' ? 'ACTIVE' : 'PENDING_PAYMENT',
          startDate,
          currentEndDate: dto.mode === 'COMPLIMENTARY' ? endDate : startDate,
          paidServiceDays: dto.mode === 'COMPLIMENTARY' ? dto.serviceDays : 0,
          pricingSnapshot: {
            source: 'STAFF_MANUAL',
            mode: dto.mode,
            pricingVersion: pricing.version,
            cashKzt: 0,
          },
          cutoffSnapshot: {
            policyVersion: cutoff.version,
            timezone: cutoff.timezone,
          },
          participants: {
            create: household.members.map((member) => ({
              memberId: member.id,
              activeFrom: startDate,
              activeTo: endDate,
              priceKzt: 0,
              pricingSnapshot: { source: 'STAFF_MANUAL', mode: dto.mode },
            })),
          },
          ...(dto.mode === 'COMPLIMENTARY'
            ? {
                serviceDays: {
                  create: Array.from(
                    { length: dto.serviceDays },
                    (_, index) => ({
                      serviceDate: new Date(startDate.getTime() + index * DAY),
                      sequence: index + 1,
                      events: {
                        create: {
                          type: ServiceDayEventType.PLAN,
                          idempotencyKey: `${dto.idempotencyKey}:day:${index + 1}`,
                          reason: dto.reason,
                          actorUserId: userId,
                        },
                      },
                    }),
                  ),
                },
              }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorEmployeeId: employee.id,
          action: `SUBSCRIPTION_MANUAL_${dto.mode}`,
          entityType: 'Subscription',
          entityId: subscription.id,
          newValues: {
            mode: dto.mode,
            householdId,
            serviceDays: dto.serviceDays,
            startDate: dto.startDate,
            noPaymentClaimed: true,
          },
          reason: dto.reason,
          requestId,
        },
      });
      return subscription;
    });
  }
}
