export type PromoInput = {
  mechanic: 'PERCENT_DISCOUNT' | 'FIXED_DISCOUNT' | 'BONUS_GRANT';
  value: number;
};

export function priceAfterPromoAndBonus(input: {
  subtotalKzt: number;
  existingDiscountKzt: number;
  requestedBonusKzt: number;
  availableBonusKzt: number;
  maxRedemptionBps: number;
  promo?: PromoInput;
}) {
  const base = Math.max(0, input.subtotalKzt - input.existingDiscountKzt);
  const promoDiscountKzt = input.promo
    ? input.promo.mechanic === 'PERCENT_DISCOUNT'
      ? Math.min(base, Math.floor((base * input.promo.value) / 10_000))
      : input.promo.mechanic === 'FIXED_DISCOUNT'
        ? Math.min(base, input.promo.value)
        : 0
    : 0;
  const afterDiscountKzt = Math.max(0, base - promoDiscountKzt);
  const redemptionLimit = Math.floor(
    (afterDiscountKzt * input.maxRedemptionBps) / 10_000,
  );
  const bonusKzt = Math.max(
    0,
    Math.min(input.requestedBonusKzt, input.availableBonusKzt, redemptionLimit),
  );
  return {
    promoDiscountKzt,
    bonusGrantKzt:
      input.promo?.mechanic === 'BONUS_GRANT' ? input.promo.value : 0,
    totalDiscountKzt: input.existingDiscountKzt + promoDiscountKzt,
    bonusKzt,
    cashKzt: Math.max(0, afterDiscountKzt - bonusKzt),
  };
}

export function ledgerBalance(
  entries: Array<{ type: string; amountKzt: number }>,
) {
  return entries.reduce((sum, entry) => {
    if (['CREDIT', 'REFUND', 'COMPENSATION'].includes(entry.type))
      return sum + entry.amountKzt;
    if (['DEBIT', 'REVERSAL', 'LIABILITY'].includes(entry.type))
      return sum - entry.amountKzt;
    return sum;
  }, 0);
}

export function referralTier<T extends { minQualifiedReferrals: number }>(
  tiers: T[],
  qualifiedCount: number,
) {
  return [...tiers]
    .sort((a, b) => b.minQualifiedReferrals - a.minQualifiedReferrals)
    .find((tier) => tier.minQualifiedReferrals <= qualifiedCount);
}
