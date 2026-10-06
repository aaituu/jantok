import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  BusinessRuleStatus,
  Prisma,
  PurchaseStatus,
  ReferralStatus,
  ServiceDayStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { CutoffService } from '../cutoff/cutoff.service.js';
import type { RecurringAddonDto } from './loyalty.dto.js';
import {
  ledgerBalance,
  priceAfterPromoAndBonus,
  referralTier,
} from './loyalty-policy.js';

type Tx = Prisma.TransactionClient;

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cutoffs: CutoffService,
  ) {}

  private requiredStatus() {
    return process.env.APP_ENV === 'production'
      ? BusinessRuleStatus.ACTIVE
      : BusinessRuleStatus.DEMO;
  }

  private async settings(tx: Tx) {
    const settings = await tx.loyaltySettings.findFirst({
      where: { status: this.requiredStatus() },
      orderBy: { version: 'desc' },
    });
    if (!settings)
      throw new UnprocessableEntityException({
        code: 'LOYALTY_SETTINGS_UNAVAILABLE',
        message: 'No applicable loyalty settings are configured',
      });
    return settings;
  }

  private async releaseExpired(tx: Tx, householdId: string, now: Date) {
    const expired = await tx.bonusReservation.findMany({
      where: {
        householdId,
        status: 'RESERVED',
        OR: [
          { expiresAt: { lte: now } },
          { quote: { status: { not: 'ACTIVE' } } },
        ],
      },
    });
    for (const item of expired) {
      await tx.bonusReservation.update({
        where: { id: item.id },
        data: { status: 'RELEASED' },
      });
      await tx.bonusLedgerEntry.upsert({
        where: { idempotencyKey: `bonus:release:${item.quoteId}` },
        create: {
          householdId,
          idempotencyKey: `bonus:release:${item.quoteId}`,
          sourceKey: `quote:${item.quoteId}`,
          type: 'RELEASE',
          amountKzt: item.amountKzt,
          reason: 'Expired or cancelled quote bonus reservation released',
        },
        update: {},
      });
    }
    await tx.promoReservation.updateMany({
      where: {
        householdId,
        status: 'RESERVED',
        OR: [
          { expiresAt: { lte: now } },
          { quote: { status: { not: 'ACTIVE' } } },
        ],
      },
      data: { status: 'RELEASED' },
    });
  }

  private async wallet(tx: Tx, householdId: string, now = new Date()) {
    await this.releaseExpired(tx, householdId, now);
    const [entries, reservations, addonReservations] = await Promise.all([
      tx.bonusLedgerEntry.findMany({
        where: { householdId },
        select: { type: true, amountKzt: true },
      }),
      tx.bonusReservation.aggregate({
        where: { householdId, status: 'RESERVED', expiresAt: { gt: now } },
        _sum: { amountKzt: true },
      }),
      tx.recurringAddonPlan.aggregate({
        where: {
          householdId,
          bonusKzt: { gt: 0 },
          status: 'PENDING_PAYMENT',
          paymentStatus: {
            in: ['CREATED', 'PENDING', 'REQUIRES_ACTION', 'UNKNOWN'],
          },
        },
        _sum: { bonusKzt: true },
      }),
    ]);
    const balanceKzt = ledgerBalance(entries);
    const reservedKzt =
      (reservations._sum.amountKzt ?? 0) +
      (addonReservations._sum.bonusKzt ?? 0);
    return {
      balanceKzt,
      reservedKzt,
      availableKzt: Math.max(0, balanceKzt - reservedKzt),
    };
  }

  async quoteAllocation(
    tx: Tx,
    input: {
      householdId: string;
      subtotalKzt: number;
      existingDiscountKzt: number;
      requestedBonusKzt: number;
      promoCode?: string;
      operation: string;
      now: Date;
    },
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.householdId}, 0))`;
    const settings = await this.settings(tx);
    const wallet = await this.wallet(tx, input.householdId, input.now);
    let promo:
      | {
          id: string;
          mechanic: 'PERCENT_DISCOUNT' | 'FIXED_DISCOUNT' | 'BONUS_GRANT';
          value: number;
        }
      | undefined;
    if (input.promoCode) {
      const record = await tx.promoCode.findFirst({
        where: { code: input.promoCode.trim().toUpperCase() },
      });
      if (
        !record ||
        record.status !== this.requiredStatus() ||
        (record.validFrom && record.validFrom > input.now) ||
        (record.validTo && record.validTo <= input.now)
      )
        throw new UnprocessableEntityException({
          code: 'PROMO_UNAVAILABLE',
          message: 'Promo code is invalid or outside its validity window',
        });
      // The household lock protects per-household limits. A second lock scoped
      // to the promotion serializes the global usage count across households,
      // so two simultaneous quotes cannot both consume the last slot.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`promo:${record.id}`}, 0))`;
      const operations = record.applicableOperations as string[];
      if (operations.length && !operations.includes(input.operation))
        throw new UnprocessableEntityException({
          code: 'PROMO_NOT_APPLICABLE',
          message: 'Promo code is not applicable to this operation',
        });
      if (input.subtotalKzt < record.minSubtotalKzt)
        throw new UnprocessableEntityException({
          code: 'PROMO_MINIMUM_NOT_MET',
          message: 'Purchase does not meet the promo minimum',
        });
      if (record.firstSubscriptionOnly) {
        const prior = await tx.purchase.count({
          where: {
            householdId: input.householdId,
            status: {
              in: [
                PurchaseStatus.PAID,
                PurchaseStatus.PARTIALLY_REFUNDED,
                PurchaseStatus.REFUNDED,
              ],
            },
          },
        });
        if (prior)
          throw new UnprocessableEntityException({
            code: 'PROMO_FIRST_SUBSCRIPTION_ONLY',
            message: 'Promo code is only valid for the first subscription',
          });
      }
      const [totalUses, householdUses] = await Promise.all([
        tx.promoReservation.count({
          where: {
            promoCodeId: record.id,
            status: { in: ['RESERVED', 'CONFIRMED'] },
            OR: [{ status: 'CONFIRMED' }, { expiresAt: { gt: input.now } }],
          },
        }),
        tx.promoReservation.count({
          where: {
            promoCodeId: record.id,
            householdId: input.householdId,
            status: { in: ['RESERVED', 'CONFIRMED'] },
            OR: [{ status: 'CONFIRMED' }, { expiresAt: { gt: input.now } }],
          },
        }),
      ]);
      if (
        (record.totalUseLimit !== null && totalUses >= record.totalUseLimit) ||
        householdUses >= record.perHouseholdUseLimit
      )
        throw new UnprocessableEntityException({
          code: 'PROMO_LIMIT_REACHED',
          message: 'Promo usage limit has been reached',
        });
      promo = { id: record.id, mechanic: record.mechanic, value: record.value };
    }
    return {
      settings,
      wallet,
      promo,
      ...priceAfterPromoAndBonus({
        subtotalKzt: input.subtotalKzt,
        existingDiscountKzt: input.existingDiscountKzt,
        requestedBonusKzt: input.requestedBonusKzt,
        availableBonusKzt: wallet.availableKzt,
        maxRedemptionBps: settings.maxRedemptionBps,
        promo,
      }),
    };
  }

  async reserveQuote(
    tx: Tx,
    input: {
      quoteId: string;
      householdId: string;
      expiresAt: Date;
      bonusKzt: number;
      promo?: { id: string };
      promoDiscountKzt: number;
      bonusGrantKzt: number;
    },
  ) {
    if (input.bonusKzt > 0) {
      await tx.bonusReservation.create({
        data: {
          quoteId: input.quoteId,
          householdId: input.householdId,
          amountKzt: input.bonusKzt,
          expiresAt: input.expiresAt,
        },
      });
      await tx.bonusLedgerEntry.create({
        data: {
          householdId: input.householdId,
          idempotencyKey: `bonus:reserve:${input.quoteId}`,
          sourceKey: `quote:${input.quoteId}`,
          type: 'RESERVE',
          amountKzt: input.bonusKzt,
          reason: 'Bonus reserved for checkout',
        },
      });
    }
    if (input.promo)
      await tx.promoReservation.create({
        data: {
          promoCodeId: input.promo.id,
          householdId: input.householdId,
          quoteId: input.quoteId,
          discountKzt: input.promoDiscountKzt,
          bonusGrantKzt: input.bonusGrantKzt,
          expiresAt: input.expiresAt,
        },
      });
  }

  async settlePurchase(
    tx: Tx,
    purchase: {
      id: string;
      quoteId: string;
      householdId: string;
      cashKzt: number;
      bonusKzt: number;
    },
    paidAt: Date,
  ) {
    const bonusReservation = await tx.bonusReservation.findUnique({
      where: { quoteId: purchase.quoteId },
    });
    if (purchase.bonusKzt > 0) {
      if (
        !bonusReservation ||
        bonusReservation.status !== 'RESERVED' ||
        bonusReservation.amountKzt !== purchase.bonusKzt
      )
        throw new UnprocessableEntityException({
          code: 'BONUS_RESERVATION_INVALID',
          message: 'Bonus reservation is missing or no longer valid',
        });
      await tx.bonusReservation.update({
        where: { id: bonusReservation.id },
        data: { status: 'CONSUMED', purchaseId: purchase.id },
      });
      await tx.bonusLedgerEntry.createMany({
        data: [
          {
            householdId: purchase.householdId,
            purchaseId: purchase.id,
            idempotencyKey: `bonus:consume-release:${purchase.id}`,
            sourceKey: `purchase:${purchase.id}`,
            type: 'RELEASE',
            amountKzt: purchase.bonusKzt,
            reason: 'Checkout bonus reservation consumed',
          },
          {
            householdId: purchase.householdId,
            purchaseId: purchase.id,
            idempotencyKey: `bonus:purchase:${purchase.id}`,
            sourceKey: `purchase:${purchase.id}`,
            type: 'DEBIT',
            amountKzt: purchase.bonusKzt,
            reason: 'Bonus portion used for purchase',
          },
        ],
        skipDuplicates: true,
      });
    }

    const promo = await tx.promoReservation.findUnique({
      where: { quoteId: purchase.quoteId },
    });
    if (promo?.status === 'RESERVED') {
      await tx.promoReservation.update({
        where: { id: promo.id },
        data: {
          status: 'CONFIRMED',
          purchaseId: purchase.id,
          confirmedAt: paidAt,
        },
      });
      if (promo.bonusGrantKzt > 0)
        await tx.bonusLedgerEntry.create({
          data: {
            householdId: purchase.householdId,
            purchaseId: purchase.id,
            idempotencyKey: `bonus:promo:${promo.id}`,
            sourceKey: `promo:${promo.id}`,
            type: 'CREDIT',
            amountKzt: promo.bonusGrantKzt,
            reason: 'Promo bonus granted after successful purchase',
          },
        });
    }

    const previousSuccessful = await tx.purchase.count({
      where: {
        householdId: purchase.householdId,
        id: { not: purchase.id },
        status: {
          in: [PurchaseStatus.PAID, PurchaseStatus.PARTIALLY_REFUNDED],
        },
      },
    });
    if (previousSuccessful === 0 && purchase.cashKzt > 0) {
      const settings = await this.settings(tx);
      const welcomeKzt = Math.floor(
        (purchase.cashKzt * settings.welcomeBonusBps) / 10_000,
      );
      if (welcomeKzt > 0)
        await tx.bonusLedgerEntry.upsert({
          where: { idempotencyKey: `bonus:welcome:${purchase.householdId}` },
          create: {
            householdId: purchase.householdId,
            purchaseId: purchase.id,
            idempotencyKey: `bonus:welcome:${purchase.householdId}`,
            sourceKey: `welcome:${purchase.id}`,
            type: 'CREDIT',
            amountKzt: welcomeKzt,
            reason: 'Welcome bonus from first successful cash payment',
            metadata: {
              settingsVersion: settings.version,
              base: settings.welcomeBase,
              rateBps: settings.welcomeBonusBps,
            },
          },
          update: {},
        });
    }
    await this.qualifyReferral(tx, purchase, paidAt);
    await this.refreshClub(tx, purchase.householdId);
  }

  private async qualifyReferral(
    tx: Tx,
    purchase: { id: string; householdId: string; cashKzt: number },
    paidAt: Date,
  ) {
    const household = await tx.household.findUniqueOrThrow({
      where: { id: purchase.householdId },
    });
    const referral = await tx.referral.findUnique({
      where: { inviteeUserId: household.ownerUserId },
      include: { referrer: { include: { household: true } } },
    });
    if (!referral || referral.status !== ReferralStatus.PENDING) return;
    const qualifiedCount =
      (await tx.referral.count({
        where: {
          referrerUserId: referral.referrerUserId,
          status: ReferralStatus.QUALIFIED,
        },
      })) + 1;
    const tiers = await tx.referralTier.findMany({
      where: { status: this.requiredStatus() },
      orderBy: { minQualifiedReferrals: 'asc' },
    });
    const tier = referralTier(tiers, qualifiedCount);
    if (!tier || !referral.referrer.household) return;
    const rewardKzt = Math.floor((purchase.cashKzt * tier.rewardBps) / 10_000);
    await tx.referral.update({
      where: { id: referral.id },
      data: {
        status: ReferralStatus.QUALIFIED,
        qualifiedPurchaseId: purchase.id,
        tierId: tier.id,
        rewardBps: tier.rewardBps,
        rewardKzt,
        qualifiedAt: paidAt,
      },
    });
    if (rewardKzt > 0)
      await tx.bonusLedgerEntry.create({
        data: {
          householdId: referral.referrer.household.id,
          purchaseId: purchase.id,
          idempotencyKey: `bonus:referral:${referral.id}`,
          sourceKey: `referral:${referral.id}`,
          type: 'CREDIT',
          amountKzt: rewardKzt,
          reason: `Referral reward at tier ${tier.code}`,
          metadata: {
            tierCode: tier.code,
            qualifiedCount,
            rewardBase: tier.rewardBase,
            rewardBps: tier.rewardBps,
          },
        },
      });
  }

  async refreshClub(tx: Tx, householdId: string) {
    const settings = await this.settings(tx);
    const statuses = settings.partialRefundKeepsClubCycle
      ? [PurchaseStatus.PAID, PurchaseStatus.PARTIALLY_REFUNDED]
      : [PurchaseStatus.PAID];
    const qualifyingPaidCycles = await tx.purchase.count({
      where: {
        householdId,
        status: { in: statuses },
        quote: { serviceDayCount: 30 },
      },
    });
    const tiers = await tx.clubTier.findMany({
      where: { status: this.requiredStatus() },
      orderBy: { thresholdPaidCycles: 'desc' },
    });
    const tier = tiers.find(
      (item) => item.thresholdPaidCycles <= qualifyingPaidCycles,
    );
    await tx.clubMembership.upsert({
      where: { householdId },
      create: { householdId, tierId: tier?.id, qualifyingPaidCycles },
      update: { tierId: tier?.id ?? null, qualifyingPaidCycles },
    });
  }

  async adjustRewardsForRefund(
    tx: Tx,
    input: {
      refundId: string;
      purchaseId: string;
      householdId: string;
      purchaseTotalKzt: number;
      cumulativeRefundKzt: number;
      fullyRefunded: boolean;
    },
  ) {
    const originals = await tx.bonusLedgerEntry.findMany({
      where: {
        purchaseId: input.purchaseId,
        type: 'CREDIT',
        OR: [
          { sourceKey: { startsWith: 'welcome:' } },
          { sourceKey: { startsWith: 'promo:' } },
          { sourceKey: { startsWith: 'referral:' } },
        ],
      },
      include: { reversals: true },
    });
    for (const original of originals) {
      const target = input.purchaseTotalKzt
        ? Math.min(
            original.amountKzt,
            Math.floor(
              (original.amountKzt * input.cumulativeRefundKzt) /
                input.purchaseTotalKzt,
            ),
          )
        : 0;
      const reversed = original.reversals.reduce(
        (sum, item) => sum + item.amountKzt,
        0,
      );
      if (target > reversed)
        await tx.bonusLedgerEntry.create({
          data: {
            householdId: original.householdId,
            purchaseId: input.purchaseId,
            refundId: input.refundId,
            reversalOfId: original.id,
            idempotencyKey: `bonus:reward-reversal:${input.refundId}:${original.id}`,
            sourceKey: original.sourceKey,
            type: 'REVERSAL',
            amountKzt: target - reversed,
            reason: 'Reward adjusted after source purchase refund',
          },
        });
    }
    if (input.fullyRefunded)
      await tx.referral.updateMany({
        where: {
          qualifiedPurchaseId: input.purchaseId,
          status: ReferralStatus.QUALIFIED,
        },
        data: { status: ReferralStatus.REVERSED, reversedAt: new Date() },
      });
    await this.refreshClub(tx, input.householdId);
  }

  async clubDashboard(userId: string) {
    const household = await this.prisma.household.findFirstOrThrow({
      where: { ownerUserId: userId, deletedAt: null },
    });
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${household.id}, 0))`;
      await this.refreshClub(tx, household.id);
      const [wallet, membership, history, referrals, nextTier] =
        await Promise.all([
          this.wallet(tx, household.id),
          tx.clubMembership.findUnique({
            where: { householdId: household.id },
            include: { tier: true },
          }),
          tx.bonusLedgerEntry.findMany({
            where: { householdId: household.id },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
          tx.referral.findMany({
            where: { referrerUserId: userId },
            include: { invitee: { select: { firstName: true } }, tier: true },
            orderBy: { createdAt: 'desc' },
          }),
          tx.clubTier.findFirst({
            where: {
              status: this.requiredStatus(),
              thresholdPaidCycles: {
                gt:
                  (
                    await tx.clubMembership.findUnique({
                      where: { householdId: household.id },
                    })
                  )?.qualifyingPaidCycles ?? 0,
              },
            },
            orderBy: { thresholdPaidCycles: 'asc' },
          }),
        ]);
      const owner = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      return {
        bonusUnit: { bonus: 1, kzt: 1, expires: false },
        wallet,
        referralCode: owner.referralCode,
        membership,
        nextTier,
        history,
        invitedFriends: referrals.map((item) => ({
          id: item.id,
          displayName: `${item.invitee.firstName.slice(0, 1)}.`,
          status: item.status,
          tier: item.tier?.code ?? null,
          qualifiedAt: item.qualifiedAt,
        })),
      };
    });
  }

  addonCatalog(_userId: string) {
    return this.prisma.addon.findMany({
      where: { active: true },
      include: {
        category: true,
        ingredients: {
          include: {
            ingredient: {
              include: { allergens: { include: { allergen: true } } },
            },
          },
        },
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { nameRu: 'asc' }],
    });
  }

  async prepareRecurringAddon(
    userId: string,
    dto: RecurringAddonDto,
    now = new Date(),
  ) {
    const existing = await this.prisma.recurringAddonPlan.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { allocations: true },
    });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findFirst({
        where: {
          id: dto.subscriptionId,
          household: { ownerUserId: userId },
          status: SubscriptionStatus.ACTIVE,
        },
        include: {
          serviceDays: true,
          participants: true,
          cutoffPolicy: true,
        },
      });
      if (!subscription)
        throw new NotFoundException('Active subscription not found');
      if (
        dto.participantId &&
        !subscription.participants.some((item) => item.id === dto.participantId)
      )
        throw new UnprocessableEntityException(
          'Participant is not in subscription',
        );
      const addon = await tx.addon.findFirst({
        where: { id: dto.addonId, active: true, verified: true },
        include: {
          ingredients: {
            include: {
              ingredient: { include: { allergens: true, tags: true } },
            },
          },
        },
      });
      if (!addon) throw new NotFoundException('Available add-on not found');
      const days = subscription.serviceDays.filter(
        (item) => item.status === ServiceDayStatus.PLANNED,
      );
      if (!days.length)
        throw new UnprocessableEntityException(
          'No payable service days remain',
        );
      this.cutoffs.assertOpen(
        subscription.cutoffPolicy,
        'standaloneAddon',
        days
          .map((item) => item.serviceDate.toISOString().slice(0, 10))
          .sort()[0],
        now,
      );
      if (dto.participantId) {
        const participant = subscription.participants.find(
          (item) => item.id === dto.participantId,
        )!;
        if (participant.memberId) {
          const member = await tx.householdMember.findUniqueOrThrow({
            where: { id: participant.memberId },
            include: {
              allergies: true,
              profile: {
                include: { dietType: { include: { excludedTags: true } } },
              },
            },
          });
          const allergyIds = new Set(
            member.allergies.flatMap((item) =>
              item.allergenId ? [item.allergenId] : [],
            ),
          );
          const excludedTags = new Set(
            member.profile?.dietType?.excludedTags.map((item) => item.tagId) ??
              [],
          );
          const unsafe =
            !addon.isHalal ||
            member.allergies.some(
              (item) => item.requiresReview || Boolean(item.freeText),
            ) ||
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
              code: 'UNSAFE_RECURRING_ADDON',
              message: 'Recurring add-on conflicts with member restrictions',
            });
        }
      }
      const paidUnits = days.length * dto.quantityPerDay;
      const unitPriceKzt = addon.recurringPriceKzt ?? addon.priceKzt;
      const totalKzt = paidUnits * unitPriceKzt;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${subscription.householdId}, 0))`;
      const wallet = await this.wallet(tx, subscription.householdId);
      const bonusKzt = Math.min(dto.bonusKzt, totalKzt, wallet.availableKzt);
      const cashKzt = totalKzt - bonusKzt;
      const reduced = await tx.addon.updateMany({
        where: { id: addon.id, stockUnits: { gte: paidUnits } },
        data: { stockUnits: { decrement: paidUnits } },
      });
      if (reduced.count !== 1)
        throw new ConflictException({
          code: 'ADDON_OUT_OF_STOCK',
          message: 'Insufficient stock',
        });
      const plan = await tx.recurringAddonPlan.create({
        data: {
          householdId: subscription.householdId,
          subscriptionId: subscription.id,
          participantId: dto.participantId,
          addonId: addon.id,
          quantityPerDay: dto.quantityPerDay,
          paidUnits,
          remainingUnits: paidUnits,
          unitPriceKzt,
          idempotencyKey: dto.idempotencyKey,
          totalKzt,
          bonusKzt,
          cashKzt,
          status: 'PENDING_PAYMENT',
          paymentStatus: cashKzt > 0 ? 'CREATED' : 'CAPTURED',
          allocations: {
            create: days.map((day) => ({
              serviceDayId: day.id,
              quantity: dto.quantityPerDay,
              status: 'PENDING_PAYMENT',
            })),
          },
        },
        include: { allocations: true },
      });
      if (bonusKzt > 0)
        await tx.bonusLedgerEntry.create({
          data: {
            householdId: subscription.householdId,
            idempotencyKey: `bonus:recurring-addon:reserve:${plan.id}`,
            sourceKey: `recurring-addon:${plan.id}`,
            type: 'RESERVE',
            amountKzt: bonusKzt,
            reason: 'Bonus reserved for recurring add-on checkout',
            metadata: {
              paidUnits,
              unitPriceKzt,
              quantityPerDay: dto.quantityPerDay,
            },
          },
        });
      return plan;
    });
  }

  async recordAddonPayment(
    planId: string,
    result: {
      operationId: string;
      status:
        | 'PENDING'
        | 'REQUIRES_ACTION'
        | 'CAPTURED'
        | 'FAILED'
        | 'CANCELLED'
        | 'UNKNOWN';
      occurredAt: Date;
      safeSnapshot: Record<string, unknown>;
    },
  ) {
    const mapped = {
      PENDING: 'PENDING',
      REQUIRES_ACTION: 'REQUIRES_ACTION',
      CAPTURED: 'CAPTURED',
      FAILED: 'FAILED',
      CANCELLED: 'CANCELLED',
      UNKNOWN: 'UNKNOWN',
    } as const;
    await this.prisma.recurringAddonPlan.update({
      where: { id: planId },
      data: {
        providerReference: result.operationId,
        providerEventTime: result.occurredAt,
        paymentStatus: mapped[result.status],
        providerResponseSnapshot: result.safeSnapshot as Prisma.InputJsonValue,
      },
    });
    if (result.status === 'CAPTURED')
      return this.finalizeRecurringAddon(planId, result.occurredAt);
    if (result.status === 'FAILED' || result.status === 'CANCELLED')
      return this.failRecurringAddon(planId, result.status);
    return this.prisma.recurringAddonPlan.findUniqueOrThrow({
      where: { id: planId },
      include: { allocations: true },
    });
  }

  async finalizeRecurringAddon(planId: string, paidAt = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.recurringAddonPlan.findUniqueOrThrow({
        where: { id: planId },
        include: { allocations: true },
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${plan.householdId}, 0))`;
      if (plan.status === 'ACTIVE') return plan;
      if (plan.cashKzt > 0 && plan.paymentStatus !== 'CAPTURED')
        throw new UnprocessableEntityException({
          code: 'AUTHORITATIVE_PAYMENT_REQUIRED',
          message: 'Recurring add-on requires provider confirmation',
        });
      if (plan.bonusKzt > 0)
        await tx.bonusLedgerEntry.createMany({
          data: [
            {
              householdId: plan.householdId,
              idempotencyKey: `bonus:recurring-addon:release:${plan.id}`,
              sourceKey: `recurring-addon:${plan.id}`,
              type: 'RELEASE',
              amountKzt: plan.bonusKzt,
              reason: 'Recurring add-on bonus reservation consumed',
            },
            {
              householdId: plan.householdId,
              idempotencyKey: `bonus:recurring-addon:debit:${plan.id}`,
              sourceKey: `recurring-addon:${plan.id}`,
              type: 'DEBIT',
              amountKzt: plan.bonusKzt,
              reason: 'Recurring add-on bonus payment',
            },
          ],
          skipDuplicates: true,
        });
      await tx.recurringAddonAllocation.updateMany({
        where: { planId: plan.id, status: 'PENDING_PAYMENT' },
        data: { status: 'PLANNED' },
      });
      return tx.recurringAddonPlan.update({
        where: { id: plan.id },
        data: { status: 'ACTIVE', paymentStatus: 'CAPTURED', paidAt },
        include: { allocations: true },
      });
    });
  }

  async failRecurringAddon(planId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.recurringAddonPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      if (['PAYMENT_FAILED', 'CANCELLED'].includes(plan.status)) return plan;
      await tx.addon.update({
        where: { id: plan.addonId },
        data: { stockUnits: { increment: plan.paidUnits } },
      });
      if (plan.bonusKzt > 0)
        await tx.bonusLedgerEntry.upsert({
          where: {
            idempotencyKey: `bonus:recurring-addon:release:${plan.id}`,
          },
          create: {
            householdId: plan.householdId,
            idempotencyKey: `bonus:recurring-addon:release:${plan.id}`,
            sourceKey: `recurring-addon:${plan.id}`,
            type: 'RELEASE',
            amountKzt: plan.bonusKzt,
            reason: `Recurring add-on payment ${reason.toLowerCase()}`,
          },
          update: {},
        });
      await tx.recurringAddonAllocation.updateMany({
        where: { planId: plan.id },
        data: { status: 'CANCELLED' },
      });
      return tx.recurringAddonPlan.update({
        where: { id: plan.id },
        data: {
          status: reason === 'CANCELLED' ? 'CANCELLED' : 'PAYMENT_FAILED',
        },
      });
    });
  }
}
