import { describe, expect, it } from 'vitest';
import {
  ledgerBalance,
  priceAfterPromoAndBonus,
  referralTier,
} from './loyalty-policy.js';

describe('Stage 4 loyalty policy', () => {
  it('applies discount, then bonus, then bank without a negative total', () => {
    expect(
      priceAfterPromoAndBonus({
        subtotalKzt: 10_000,
        existingDiscountKzt: 1_000,
        requestedBonusKzt: 20_000,
        availableBonusKzt: 7_000,
        maxRedemptionBps: 10_000,
        promo: { mechanic: 'PERCENT_DISCOUNT', value: 2_000 },
      }),
    ).toEqual({
      promoDiscountKzt: 1_800,
      bonusGrantKzt: 0,
      totalDiscountKzt: 2_800,
      bonusKzt: 7_000,
      cashKzt: 200,
    });
  });

  it('supports a completely bonus-funded purchase', () => {
    expect(
      priceAfterPromoAndBonus({
        subtotalKzt: 5_000,
        existingDiscountKzt: 0,
        requestedBonusKzt: 5_000,
        availableBonusKzt: 5_000,
        maxRedemptionBps: 10_000,
      }).cashKzt,
    ).toBe(0);
  });

  it('replays immutable monetary ledger entries', () => {
    expect(
      ledgerBalance([
        { type: 'CREDIT', amountKzt: 10_000 },
        { type: 'RESERVE', amountKzt: 4_000 },
        { type: 'RELEASE', amountKzt: 4_000 },
        { type: 'DEBIT', amountKzt: 4_000 },
        { type: 'REFUND', amountKzt: 1_000 },
      ]),
    ).toBe(7_000);
  });

  it('uses the newly reached referral tier without retroactive repricing', () => {
    const tiers = [
      { code: 'ONE', minQualifiedReferrals: 1 },
      { code: 'THREE', minQualifiedReferrals: 3 },
      { code: 'FIVE', minQualifiedReferrals: 5 },
    ];
    expect(referralTier(tiers, 4)?.code).toBe('THREE');
  });
});
