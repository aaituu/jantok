import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  BusinessRuleStatus,
  PurchaseStatus,
  QuoteStatus,
  ServiceDayEventType,
  ServiceDayStatus,
  SubscriptionChangeType,
  SubscriptionStatus,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { ageGroupAt } from '../nutrition/nutrition.service.js';
import { CutoffService } from '../cutoff/cutoff.service.js';
import { renewalSchedule } from '../payments/payment-policy.js';
import { PaymentService } from '../payments/payment.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { randomUUID } from 'node:crypto';
import type {
  CheckoutDto,
  ChangeCheckoutDto,
  CreateQuoteDto,
  GuestChangeQuoteDto,
  MemberChangeQuoteDto,
  PauseDto,
  SkipDayDto,
  StandaloneAddonQuoteDto,
} from './subscription.dto.js';

const DAY = 86400000;
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const plusDays = (value: Date, count: number) =>
  new Date(value.getTime() + count * DAY);
const almatyToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cutoffs: CutoffService,
    private readonly payments: PaymentService,
    private readonly loyalty: LoyaltyService,
  ) {}

  private async household(userId: string) {
    const household = await this.prisma.household.findFirst({
      where: { ownerUserId: userId, deletedAt: null },
      include: { members: { where: { deletedAt: null, status: 'ACTIVE' } } },
    });
    if (!household) throw new NotFoundException('Household not found');
    return household;
  }

  async quote(userId: string, dto: CreateQuoteDto, now = new Date()) {
    const household = await this.household(userId);
    const address = await this.prisma.householdAddress.findFirst({
      where: { id: dto.addressId, householdId: household.id, deletedAt: null },
    });
    if (!address) throw new NotFoundException('Address not found');
    const selected = household.members.filter((item) =>
      dto.memberIds.includes(item.id),
    );
    if (selected.length !== dto.memberIds.length)
      throw new UnprocessableEntityException({
        code: 'INVALID_SUBSCRIPTION_MEMBERS',
        message: 'Every selected member must be active in this household',
      });
    const cutoff = await this.cutoffs.currentPolicy(now);
    const serviceDayCount = cutoff.serviceDaysPerCycle;
    const tomorrow = dateString(plusDays(date(almatyToday(now)), 1));
    const earliest = this.cutoffs.decide(cutoff, 'payment', tomorrow, now)
      .allowed
      ? tomorrow
      : dateString(plusDays(date(tomorrow), 1));
    if (dto.startDate < earliest)
      throw new UnprocessableEntityException({
        code: 'START_DATE_TOO_EARLY',
        message: `Earliest available start date is ${earliest}`,
        details: { earliestStartDate: earliest },
      });
    const requiredStatus =
      process.env.APP_ENV === 'production'
        ? BusinessRuleStatus.ACTIVE
        : BusinessRuleStatus.DEMO;
    const rules = await this.prisma.pricingRuleSet.findFirst({
      where: {
        status: requiredStatus,
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
      },
      orderBy: { version: 'desc' },
    });
    if (!rules)
      throw new UnprocessableEntityException({
        code: 'PRICING_UNAVAILABLE',
        message: 'No active business pricing is configured',
      });
    const fields = {
      AGE_0_5: rules.infantMonthlyKzt,
      AGE_6_12: rules.childMonthlyKzt,
      AGE_13_17: rules.teenMonthlyKzt,
      AGE_18_PLUS: rules.adultMonthlyKzt,
    } as const;
    const memberLines = selected.map((member, index) => {
      if (!member.birthDate)
        throw new UnprocessableEntityException({
          code: 'MEMBER_BIRTH_DATE_REQUIRED',
          message: `Birth date is required for member ${member.id}`,
        });
      const ageGroup = ageGroupAt(member.birthDate, date(dto.startDate));
      const unitKzt = fields[ageGroup];
      const discountBps =
        index === 0
          ? 0
          : index === 1
            ? rules.secondMemberDiscountBps
            : rules.thirdPlusDiscountBps;
      const discountKzt = Math.round((unitKzt * discountBps) / 10000);
      return { member, ageGroup, unitKzt, discountBps, discountKzt };
    });
    const guestTotal = dto.guestDays * rules.guestDayKzt;
    const subtotalKzt =
      memberLines.reduce((sum, item) => sum + item.unitKzt, 0) + guestTotal;
    const discountKzt = memberLines.reduce(
      (sum, item) => sum + item.discountKzt,
      0,
    );
    const baseLines: Prisma.PriceQuoteLineCreateWithoutQuoteInput[] =
      memberLines.map((item) => ({
        member: { connect: { id: item.member.id } },
        kind: 'MEMBER_MONTH',
        description: `${item.member.firstName}: ${serviceDayCount} service days`,
        quantity: 1,
        unitKzt: item.unitKzt,
        totalKzt: item.unitKzt - item.discountKzt,
        details: {
          ageGroup: item.ageGroup,
          discountBps: item.discountBps,
          discountKzt: item.discountKzt,
          pricingRuleVersion: rules.version,
        },
      }));
    if (dto.guestDays)
      baseLines.push({
        kind: 'GUEST_DAYS',
        description: `${dto.guestDays} guest service day(s)`,
        quantity: dto.guestDays,
        unitKzt: rules.guestDayKzt,
        totalKzt: guestTotal,
        details: { pricingRuleVersion: rules.version },
      });
    const paymentDeadline = this.cutoffs.decide(
      cutoff,
      'payment',
      dto.startDate,
      now,
    ).deadline;
    return this.prisma.$transaction(async (tx) => {
      const allocation = await this.loyalty.quoteAllocation(tx, {
        householdId: household.id,
        subtotalKzt,
        existingDiscountKzt: discountKzt,
        requestedBonusKzt: dto.bonusKzt,
        promoCode: dto.promoCode,
        operation: 'SUBSCRIPTION',
        now,
      });
      const quoteId = randomUUID();
      const lines = [...baseLines];
      if (allocation.promoDiscountKzt)
        lines.push({
          kind: 'PROMO',
          description: `Promo ${dto.promoCode?.trim().toUpperCase()}`,
          quantity: 1,
          unitKzt: -allocation.promoDiscountKzt,
          totalKzt: -allocation.promoDiscountKzt,
          details: {
            promoCode: dto.promoCode?.trim().toUpperCase(),
            mechanic: allocation.promo?.mechanic,
          },
        });
      if (allocation.bonusKzt)
        lines.push({
          kind: 'BONUS',
          description: 'Bonus redemption',
          quantity: 1,
          unitKzt: -allocation.bonusKzt,
          totalKzt: -allocation.bonusKzt,
          details: { requestedKzt: dto.bonusKzt },
        });
      const quote = await tx.priceQuote.create({
        data: {
          id: quoteId,
          householdId: household.id,
          addressId: address.id,
          pricingRuleSetId: rules.id,
          startDate: date(dto.startDate),
          serviceDayCount,
          subtotalKzt,
          discountKzt: allocation.totalDiscountKzt,
          bonusKzt: allocation.bonusKzt,
          cashKzt: allocation.cashKzt,
          inputSnapshot: {
            memberIds: dto.memberIds,
            addressId: dto.addressId,
            startDate: dto.startDate,
            guestDays: dto.guestDays,
            promoCode: dto.promoCode?.trim().toUpperCase(),
            cutoffPolicyVersion: cutoff.version,
            serviceDayCount,
          },
          breakdownSnapshot: {
            currency: 'KZT',
            subtotalKzt,
            baseDiscountKzt: discountKzt,
            promoDiscountKzt: allocation.promoDiscountKzt,
            discountKzt: allocation.totalDiscountKzt,
            bonusKzt: allocation.bonusKzt,
            cashKzt: allocation.cashKzt,
            pricingRuleVersion: rules.version,
            serviceDayCount,
            loyaltySettingsVersion: allocation.settings.version,
          },
          expiresAt: paymentDeadline,
          lines: { create: lines },
        },
        include: { lines: true },
      });
      await this.loyalty.reserveQuote(tx, {
        quoteId,
        householdId: household.id,
        expiresAt: paymentDeadline,
        bonusKzt: allocation.bonusKzt,
        promo: allocation.promo,
        promoDiscountKzt: allocation.promoDiscountKzt,
        bonusGrantKzt: allocation.bonusGrantKzt,
      });
      return quote;
    });
  }

  async checkout(userId: string, dto: CheckoutDto, now = new Date()) {
    // Kept as a compatibility entry point for callers from Stage 2. All payment
    // authority and activation now live behind the payment provider boundary.
    return this.payments.checkout(userId, dto, now);
  }

  current(userId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        household: { ownerUserId: userId },
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED] },
      },
      include: {
        participants: { include: { member: true, guest: true } },
        serviceDays: {
          orderBy: { serviceDate: 'asc' },
          include: {
            events: { orderBy: { createdAt: 'asc' } },
            dailyFulfillment: true,
          },
        },
        pauses: { orderBy: { startDate: 'asc' } },
        dailyOrders: { include: { lines: true } },
        standaloneAddonOrders: true,
        recurringAddonPlans: {
          include: { addon: true, allocations: true },
        },
        renewalJobs: {
          orderBy: { createdAt: 'desc' },
          include: {
            paymentMethod: {
              select: {
                id: true,
                brand: true,
                last4: true,
                mandateActive: true,
              },
            },
          },
        },
        purchase: { include: { quote: { include: { lines: true } } } },
      },
    });
  }

  async skip(userId: string, subscriptionId: string, dto: SkipDayDto) {
    const prior = await this.prisma.serviceDayEvent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { serviceDay: true },
    });
    if (prior) return prior.serviceDay;
    const subscription = await this.ownedSubscription(userId, subscriptionId);
    this.cutoffs.assertOpen(subscription.cutoffPolicy, 'skip', dto.serviceDate);
    const target = subscription.serviceDays.find(
      (item) => dateString(item.serviceDate) === dto.serviceDate,
    );
    if (!target || target.status !== ServiceDayStatus.PLANNED)
      throw new UnprocessableEntityException({
        code: 'SERVICE_DAY_NOT_SKIPPABLE',
        message: 'Only a planned service day can be skipped',
      });
    if (
      target.dailyFulfillment &&
      target.dailyFulfillment.status !== 'SCHEDULED'
    )
      throw new UnprocessableEntityException({
        code: 'DAILY_ORDER_ALREADY_LOCKED',
        message: 'The household daily order can no longer be skipped',
      });
    return this.prisma.$transaction(async (tx) => {
      const extensionDate = plusDays(subscription.currentEndDate, 1);
      await tx.subscriptionServiceDay.update({
        where: { id: target.id },
        data: { status: ServiceDayStatus.SKIPPED, version: { increment: 1 } },
      });
      await tx.dailyOrder.updateMany({
        where: { serviceDayId: target.id },
        data: { status: 'SKIPPED' },
      });
      if (target.dailyFulfillment) {
        await tx.dailyFulfillment.update({
          where: { id: target.dailyFulfillment.id },
          data: { status: 'SKIPPED', version: { increment: 1 } },
        });
        await tx.dailyFulfillmentEvent.create({
          data: {
            fulfillmentId: target.dailyFulfillment.id,
            idempotencyKey: `${dto.idempotencyKey}:fulfillment`,
            type: 'STATUS_TRANSITION',
            fromStatus: 'SCHEDULED',
            toStatus: 'SKIPPED',
            actorType: 'SYSTEM',
            actorUserId: userId,
            reason: 'Service day skipped before cutoff',
          },
        });
        await tx.deliveryJob.updateMany({
          where: { fulfillmentId: target.dailyFulfillment.id },
          data: { status: 'CANCELLED', lastError: 'Service day skipped' },
        });
      }
      await tx.serviceDayEvent.create({
        data: {
          serviceDayId: target.id,
          type: ServiceDayEventType.TRANSFER,
          idempotencyKey: dto.idempotencyKey,
          fromDate: target.serviceDate,
          toDate: extensionDate,
          actorUserId: userId,
        },
      });
      const replacement = await tx.subscriptionServiceDay.create({
        data: {
          subscriptionId,
          serviceDate: extensionDate,
          sequence: subscription.serviceDays.length + 1,
          transferredFrom: target.serviceDate,
          events: {
            create: {
              type: ServiceDayEventType.PLAN,
              idempotencyKey: `${dto.idempotencyKey}:replacement`,
              fromDate: target.serviceDate,
              actorUserId: userId,
            },
          },
        },
      });
      for (const allocation of target.recurringAddonAllocations) {
        await tx.recurringAddonAllocation.update({
          where: { id: allocation.id },
          data: { status: 'MOVED' },
        });
        await tx.recurringAddonAllocation.create({
          data: {
            planId: allocation.planId,
            serviceDayId: replacement.id,
            quantity: allocation.quantity,
            movedFromId: allocation.id,
          },
        });
      }
      for (const order of target.orders)
        await tx.dailyOrder.create({
          data: {
            subscriptionId,
            serviceDayId: replacement.id,
            participantId: order.participantId,
            memberId: order.memberId,
            serviceDate: extensionDate,
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
        data: { currentEndDate: extensionDate },
      });
      await this.rescheduleRenewal(tx, subscriptionId, extensionDate);
      return replacement;
    });
  }

  async pause(userId: string, subscriptionId: string, dto: PauseDto) {
    const prior = await this.prisma.subscriptionPause.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (prior) return prior;
    const subscription = await this.ownedSubscription(userId, subscriptionId);
    const start = date(dto.startDate);
    const end = date(dto.endDate);
    const calendarDays =
      Math.floor((end.getTime() - start.getTime()) / DAY) + 1;
    if (calendarDays < 1)
      throw new UnprocessableEntityException(
        'Pause end must not precede start',
      );
    this.cutoffs.assertOpen(subscription.cutoffPolicy, 'skip', dto.startDate);
    const used = subscription.pauses.reduce(
      (sum, item) => sum + item.calendarDays,
      0,
    );
    if (used + calendarDays > subscription.cutoffPolicy.maxPauseCalendarDays)
      throw new UnprocessableEntityException({
        code: 'PAUSE_LIMIT_EXCEEDED',
        message: 'Total pause limit is exceeded',
      });
    if (
      subscription.pauses.some(
        (item) => item.startDate <= end && item.endDate >= start,
      )
    )
      throw new ConflictException({
        code: 'PAUSE_OVERLAP',
        message: 'Pause periods cannot overlap',
      });
    const affected = subscription.serviceDays.filter(
      (item) =>
        item.status === ServiceDayStatus.PLANNED &&
        item.serviceDate >= start &&
        item.serviceDate <= end,
    );
    if (
      affected.some(
        (item) =>
          item.dailyFulfillment && item.dailyFulfillment.status !== 'SCHEDULED',
      )
    )
      throw new UnprocessableEntityException({
        code: 'DAILY_ORDER_ALREADY_LOCKED',
        message: 'At least one household daily order can no longer be paused',
      });
    return this.prisma.$transaction(async (tx) => {
      const pause = await tx.subscriptionPause.create({
        data: {
          subscriptionId,
          startDate: start,
          endDate: end,
          calendarDays,
          idempotencyKey: dto.idempotencyKey,
        },
      });
      let extension = subscription.currentEndDate;
      for (const [index, item] of affected.entries()) {
        extension = plusDays(extension, 1);
        await tx.subscriptionServiceDay.update({
          where: { id: item.id },
          data: { status: ServiceDayStatus.PAUSED, version: { increment: 1 } },
        });
        await tx.dailyOrder.updateMany({
          where: { serviceDayId: item.id },
          data: { status: 'PAUSED' },
        });
        if (item.dailyFulfillment) {
          await tx.dailyFulfillment.update({
            where: { id: item.dailyFulfillment.id },
            data: { status: 'SKIPPED', version: { increment: 1 } },
          });
          await tx.dailyFulfillmentEvent.create({
            data: {
              fulfillmentId: item.dailyFulfillment.id,
              idempotencyKey: `${dto.idempotencyKey}:fulfillment:${item.id}`,
              type: 'STATUS_TRANSITION',
              fromStatus: 'SCHEDULED',
              toStatus: 'SKIPPED',
              actorType: 'SYSTEM',
              actorUserId: userId,
              reason: 'Service day moved by subscription pause',
            },
          });
          await tx.deliveryJob.updateMany({
            where: { fulfillmentId: item.dailyFulfillment.id },
            data: { status: 'CANCELLED', lastError: 'Service day paused' },
          });
        }
        await tx.serviceDayEvent.create({
          data: {
            serviceDayId: item.id,
            type: ServiceDayEventType.TRANSFER,
            idempotencyKey: `${dto.idempotencyKey}:transfer:${item.id}`,
            fromDate: item.serviceDate,
            toDate: extension,
            actorUserId: userId,
          },
        });
        const replacement = await tx.subscriptionServiceDay.create({
          data: {
            subscriptionId,
            serviceDate: extension,
            sequence: subscription.serviceDays.length + index + 1,
            transferredFrom: item.serviceDate,
            events: {
              create: {
                type: ServiceDayEventType.PLAN,
                idempotencyKey: `${dto.idempotencyKey}:replacement:${item.id}`,
                actorUserId: userId,
              },
            },
          },
        });
        for (const allocation of item.recurringAddonAllocations) {
          await tx.recurringAddonAllocation.update({
            where: { id: allocation.id },
            data: { status: 'MOVED' },
          });
          await tx.recurringAddonAllocation.create({
            data: {
              planId: allocation.planId,
              serviceDayId: replacement.id,
              quantity: allocation.quantity,
              movedFromId: allocation.id,
            },
          });
        }
        for (const order of item.orders)
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
      }
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          currentEndDate: extension,
          status: SubscriptionStatus.PAUSED,
        },
      });
      await this.rescheduleRenewal(tx, subscriptionId, extension);
      return pause;
    });
  }

  async memberChangeQuote(
    userId: string,
    subscriptionId: string,
    dto: MemberChangeQuoteDto,
    now = new Date(),
  ) {
    const subscription = await this.changeContext(userId, subscriptionId);
    if (
      subscription.participants.some((item) => item.memberId === dto.memberId)
    )
      throw new ConflictException('Member already participates in this cycle');
    const member = await this.prisma.householdMember.findFirst({
      where: {
        id: dto.memberId,
        householdId: subscription.householdId,
        deletedAt: null,
        status: 'ACTIVE',
      },
    });
    if (!member?.birthDate)
      throw new UnprocessableEntityException(
        'Active member birth date is required',
      );
    const eligible = subscription.serviceDays.filter(
      (item) =>
        item.status === ServiceDayStatus.PLANNED &&
        this.cutoffs.decide(
          subscription.cutoffPolicy,
          'payment',
          dateString(item.serviceDate),
          now,
        ).allowed,
    );
    if (!eligible.length)
      throw new UnprocessableEntityException({
        code: 'NO_ELIGIBLE_SERVICE_DAYS',
        message: 'No remaining service day is still open for payment',
      });
    const rules = subscription.purchase.quote.pricingRuleSet;
    const group = ageGroupAt(member.birthDate, eligible[0].serviceDate);
    const monthly = {
      AGE_0_5: rules.infantMonthlyKzt,
      AGE_6_12: rules.childMonthlyKzt,
      AGE_13_17: rules.teenMonthlyKzt,
      AGE_18_PLUS: rules.adultMonthlyKzt,
    }[group];
    const position = subscription.participants.filter(
      (item) => item.memberId,
    ).length;
    const discountBps =
      position === 0
        ? 0
        : position === 1
          ? rules.secondMemberDiscountBps
          : rules.thirdPlusDiscountBps;
    const cycleDays = subscription.purchase.quote.serviceDayCount;
    const gross = Math.round((monthly * eligible.length) / cycleDays);
    const discount = Math.round((gross * discountBps) / 10000);
    const subtotalKzt = gross - discount;
    const bonusKzt = Math.min(dto.bonusKzt, subtotalKzt);
    const expiresAt = this.cutoffs.decide(
      subscription.cutoffPolicy,
      'payment',
      dateString(eligible[0].serviceDate),
      now,
    ).deadline;
    return this.prisma.subscriptionChangeQuote.create({
      data: {
        subscriptionId,
        type: SubscriptionChangeType.PERMANENT_MEMBER,
        memberId: member.id,
        serviceDates: eligible.map((item) => dateString(item.serviceDate)),
        subtotalKzt,
        bonusKzt,
        cashKzt: subtotalKzt - bonusKzt,
        expiresAt,
        breakdownSnapshot: {
          pricingRuleVersion: rules.version,
          memberId: member.id,
          ageGroup: group,
          monthlyKzt: monthly,
          eligibleDays: eligible.length,
          cycleDays,
          formula: 'round(monthlyKzt * eligibleDays / cycleDays)',
          grossKzt: gross,
          discountBps,
          discountKzt: discount,
          bonusKzt,
          cashKzt: subtotalKzt - bonusKzt,
        },
      },
    });
  }

  async guestChangeQuote(
    userId: string,
    subscriptionId: string,
    dto: GuestChangeQuoteDto,
    now = new Date(),
  ) {
    const subscription = await this.changeContext(userId, subscriptionId);
    const uniqueDates = [...dto.serviceDates].sort();
    const selected = subscription.serviceDays.filter((item) =>
      uniqueDates.includes(dateString(item.serviceDate)),
    );
    if (selected.length !== uniqueDates.length || uniqueDates.length < 1)
      throw new UnprocessableEntityException({
        code: 'INVALID_GUEST_DAYS',
        message: 'Guest dates must be service days in the active subscription',
      });
    for (const serviceDate of uniqueDates)
      this.cutoffs.assertOpen(
        subscription.cutoffPolicy,
        'payment',
        serviceDate,
        now,
      );
    const rules = subscription.purchase.quote.pricingRuleSet;
    const subtotalKzt = rules.guestDayKzt * uniqueDates.length;
    const bonusKzt = Math.min(dto.bonusKzt, subtotalKzt);
    const guest = await this.prisma.subscriptionGuest.create({
      data: {
        householdId: subscription.householdId,
        displayName: dto.displayName.trim(),
        nutritionSnapshot: dto.nutritionSnapshot as Prisma.InputJsonValue,
        allergySnapshot: dto.allergySnapshot as Prisma.InputJsonValue,
      },
    });
    return this.prisma.subscriptionChangeQuote.create({
      data: {
        subscriptionId,
        type: SubscriptionChangeType.GUEST_DAYS,
        guestId: guest.id,
        serviceDates: uniqueDates,
        subtotalKzt,
        bonusKzt,
        cashKzt: subtotalKzt - bonusKzt,
        expiresAt: this.cutoffs.decide(
          subscription.cutoffPolicy,
          'payment',
          uniqueDates[0],
          now,
        ).deadline,
        breakdownSnapshot: {
          pricingRuleVersion: rules.version,
          guestId: guest.id,
          serviceDates: uniqueDates,
          dayRateKzt: rules.guestDayKzt,
          subtotalKzt,
          bonusKzt,
          cashKzt: subtotalKzt - bonusKzt,
        },
      },
      include: { guest: true },
    });
  }

  async changeCheckout(
    userId: string,
    subscriptionId: string,
    dto: ChangeCheckoutDto,
    now = new Date(),
  ) {
    const prior = await this.prisma.subscriptionCharge.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { quote: true },
    });
    if (prior) return prior;
    const quote = await this.prisma.subscriptionChangeQuote.findFirst({
      where: {
        id: dto.quoteId,
        subscriptionId,
        status: QuoteStatus.ACTIVE,
        subscription: { household: { ownerUserId: userId } },
      },
      include: {
        member: true,
        guest: true,
        subscription: {
          include: {
            participants: true,
            serviceDays: { include: { dailyFulfillment: true } },
            purchase: { include: { quote: { include: { address: true } } } },
          },
        },
      },
    });
    if (!quote) throw new NotFoundException('Active change quote not found');
    if (now >= quote.expiresAt)
      throw new UnprocessableEntityException('Change quote has expired');
    if (quote.cashKzt > 0 && process.env.APP_ENV === 'production')
      throw new UnprocessableEntityException({
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message: 'Production payment provider is not configured',
      });
    const serviceDates = quote.serviceDates as string[];
    return this.prisma.$transaction(async (tx) => {
      const charge = await tx.subscriptionCharge.create({
        data: {
          quoteId: quote.id,
          idempotencyKey: dto.idempotencyKey,
          status: PurchaseStatus.PAID,
          cashKzt: quote.cashKzt,
          bonusKzt: quote.bonusKzt,
          paidAt: now,
        },
      });
      if (quote.type === SubscriptionChangeType.STANDALONE_ADDON) {
        const details = quote.breakdownSnapshot as {
          addonId: string;
          quantity: number;
          serviceDate: string;
          addonSnapshot: Prisma.InputJsonValue;
        };
        const participant = quote.subscription.participants.find(
          (item) => item.memberId === quote.memberId,
        );
        const day = quote.subscription.serviceDays.find(
          (item) => dateString(item.serviceDate) === details.serviceDate,
        );
        if (!participant || !day)
          throw new UnprocessableEntityException(
            'Add-on target is unavailable',
          );
        const reserved = await tx.addon.updateMany({
          where: { id: details.addonId, stockUnits: { gte: details.quantity } },
          data: { stockUnits: { decrement: details.quantity } },
        });
        if (reserved.count !== 1)
          throw new ConflictException({
            code: 'ADDON_OUT_OF_STOCK',
            message: 'Standalone add-on is out of stock',
          });
        const order = await tx.standaloneAddonOrder.create({
          data: {
            subscriptionId,
            serviceDayId: day.id,
            participantId: participant.id,
            addonId: details.addonId,
            quantity: details.quantity,
            addonSnapshot: details.addonSnapshot,
            priceSnapshot: quote.breakdownSnapshot as Prisma.InputJsonValue,
          },
        });
        await tx.subscriptionChangeQuote.update({
          where: { id: quote.id },
          data: { status: QuoteStatus.ACCEPTED },
        });
        return { ...charge, standaloneAddonOrder: order };
      }
      const participant = await tx.subscriptionParticipant.create({
        data: {
          subscriptionId,
          memberId: quote.memberId,
          guestId: quote.guestId,
          activeFrom: date(serviceDates[0]),
          activeTo: date(serviceDates[serviceDates.length - 1]),
          priceKzt: quote.subtotalKzt,
          pricingSnapshot: quote.breakdownSnapshot as Prisma.InputJsonValue,
        },
      });
      const address = quote.subscription.purchase.quote.address;
      for (const serviceDate of serviceDates) {
        const day = quote.subscription.serviceDays.find(
          (item) => dateString(item.serviceDate) === serviceDate,
        )!;
        await tx.dailyOrder.create({
          data: {
            subscriptionId,
            serviceDayId: day.id,
            participantId: participant.id,
            memberId: quote.memberId,
            dailyFulfillmentId: day.dailyFulfillment?.id,
            serviceDate: day.serviceDate,
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
              windowStart: address.windowStart,
              windowEnd: address.windowEnd,
            },
          },
        });
      }
      await tx.subscriptionChangeQuote.update({
        where: { id: quote.id },
        data: { status: QuoteStatus.ACCEPTED },
      });
      return { ...charge, participant };
    });
  }

  async setAutoRenew(userId: string, subscriptionId: string, enabled: boolean) {
    await this.ownedSubscription(userId, subscriptionId);
    return this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { autoRenew: enabled },
      select: { id: true, autoRenew: true, updatedAt: true },
    });
  }

  async standaloneAddonQuote(
    userId: string,
    subscriptionId: string,
    dto: StandaloneAddonQuoteDto,
    now = new Date(),
  ) {
    const subscription = await this.changeContext(userId, subscriptionId);
    this.cutoffs.assertOpen(
      subscription.cutoffPolicy,
      'standaloneAddon',
      dto.serviceDate,
      now,
    );
    const participant = subscription.participants.find(
      (item) => item.memberId === dto.memberId,
    );
    const day = subscription.serviceDays.find(
      (item) =>
        dateString(item.serviceDate) === dto.serviceDate &&
        item.status === ServiceDayStatus.PLANNED,
    );
    if (!participant || !day)
      throw new UnprocessableEntityException(
        'Member/service day is unavailable',
      );
    const member = await this.prisma.householdMember.findFirst({
      where: { id: dto.memberId, householdId: subscription.householdId },
      include: {
        allergies: true,
        profile: { include: { dietType: { include: { excludedTags: true } } } },
      },
    });
    const addon = await this.prisma.addon.findFirst({
      where: { id: dto.addonId, active: true },
      include: {
        ingredients: {
          include: { ingredient: { include: { allergens: true, tags: true } } },
        },
      },
    });
    if (!member || !addon || addon.stockUnits < dto.quantity)
      throw new UnprocessableEntityException('Add-on is unavailable');
    const allergyIds = new Set(
      member.allergies.flatMap((item) =>
        item.allergenId ? [item.allergenId] : [],
      ),
    );
    const excludedTags = new Set(
      member.profile?.dietType?.excludedTags.map((item) => item.tagId) ?? [],
    );
    const unsafe =
      !addon.isHalal ||
      !addon.verified ||
      member.allergies.some((item) => item.requiresReview || item.freeText) ||
      addon.ingredients.some(
        (item) =>
          !item.ingredient.isHalal ||
          !item.ingredient.verified ||
          item.ingredient.allergens.some((risk) =>
            allergyIds.has(risk.allergenId),
          ) ||
          item.ingredient.tags.some((tag) => excludedTags.has(tag.tagId)),
      );
    if (unsafe)
      throw new UnprocessableEntityException({
        code: 'UNSAFE_STANDALONE_ADDON',
        message: 'Standalone add-on is unsafe for this member',
      });
    const subtotalKzt = addon.priceKzt * dto.quantity;
    const bonusKzt = Math.min(dto.bonusKzt, subtotalKzt);
    return this.prisma.subscriptionChangeQuote.create({
      data: {
        subscriptionId,
        type: SubscriptionChangeType.STANDALONE_ADDON,
        memberId: dto.memberId,
        serviceDates: [dto.serviceDate],
        subtotalKzt,
        bonusKzt,
        cashKzt: subtotalKzt - bonusKzt,
        expiresAt: this.cutoffs.decide(
          subscription.cutoffPolicy,
          'standaloneAddon',
          dto.serviceDate,
          now,
        ).deadline,
        breakdownSnapshot: {
          addonId: addon.id,
          quantity: dto.quantity,
          serviceDate: dto.serviceDate,
          unitKzt: addon.priceKzt,
          subtotalKzt,
          bonusKzt,
          cashKzt: subtotalKzt - bonusKzt,
          addonSnapshot: {
            id: addon.id,
            code: addon.code,
            nameKk: addon.nameKk,
            nameRu: addon.nameRu,
            nameEn: addon.nameEn,
            ingredients: addon.ingredients.map((item) => ({
              ingredientId: item.ingredientId,
              amount: Number(item.amount),
              unit: item.unit,
            })),
          },
        },
      },
    });
  }

  private async changeContext(userId: string, id: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        id,
        household: { ownerUserId: userId },
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED] },
      },
      include: {
        cutoffPolicy: true,
        participants: true,
        serviceDays: { orderBy: { serviceDate: 'asc' } },
        purchase: { include: { quote: { include: { pricingRuleSet: true } } } },
      },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');
    return subscription;
  }

  private async rescheduleRenewal(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
    endDate: Date,
  ) {
    const settings = await tx.paymentSettings.findFirst({
      where: { active: true },
      orderBy: { version: 'desc' },
    });
    if (!settings) return;
    const schedule = renewalSchedule(
      endDate,
      settings.renewalNoticeDays,
      settings.businessTimezone,
    );
    await tx.renewalJob.updateMany({
      where: {
        subscriptionId,
        status: {
          in: ['SCHEDULED', 'NOTICE_SENT', 'RETRY_SCHEDULED'],
        },
      },
      data: {
        cycleEndDate: endDate,
        expectedChargeAt: schedule.expectedChargeAt,
        notificationDueAt: schedule.notificationDueAt,
        notifiedAt: null,
        status: 'SCHEDULED',
        nextAttemptAt: null,
      },
    });
  }

  private async ownedSubscription(userId: string, id: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        id,
        household: { ownerUserId: userId },
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED] },
      },
      include: {
        cutoffPolicy: true,
        serviceDays: {
          orderBy: { sequence: 'asc' },
          include: {
            orders: { include: { lines: true } },
            recurringAddonAllocations: true,
            dailyFulfillment: true,
          },
        },
        pauses: true,
      },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');
    return subscription;
  }
}
