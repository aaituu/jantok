export type RefundPolicyInput = {
  paidCashKzt: number;
  paidBonusKzt: number;
  alreadyRefundedCashKzt: number;
  alreadyRefundedBonusKzt: number;
  paidServiceDays: number;
  usedServiceDays: number;
  firstDeliveredOn: string | null;
  requestedOn: string;
  refundWindowCalendarDays: number;
};

const calendarDistance = (from: string, to: string) =>
  Math.floor(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );

export function calculateStandardRefund(input: RefundPolicyInput) {
  const remainingDays = Math.max(
    0,
    input.paidServiceDays - input.usedServiceDays,
  );
  const kind = input.firstDeliveredOn
    ? ('UNUSED_WITHIN_WINDOW' as const)
    : ('BEFORE_FIRST_DELIVERY' as const);
  if (
    input.firstDeliveredOn &&
    (calendarDistance(input.firstDeliveredOn, input.requestedOn) < 0 ||
      calendarDistance(input.firstDeliveredOn, input.requestedOn) >=
        input.refundWindowCalendarDays)
  )
    return { allowed: false as const, code: 'REFUND_WINDOW_CLOSED', kind };
  if (remainingDays === 0)
    return { allowed: false as const, code: 'NO_UNUSED_SERVICE_DAYS', kind };

  const ratio = remainingDays / input.paidServiceDays;
  const policyCash = input.firstDeliveredOn
    ? Math.floor(input.paidCashKzt * ratio)
    : input.paidCashKzt;
  const policyBonus = input.firstDeliveredOn
    ? Math.floor(input.paidBonusKzt * ratio)
    : input.paidBonusKzt;
  return {
    allowed: true as const,
    kind,
    cashKzt: Math.min(
      policyCash,
      input.paidCashKzt - input.alreadyRefundedCashKzt,
    ),
    bonusKzt: Math.min(
      policyBonus,
      input.paidBonusKzt - input.alreadyRefundedBonusKzt,
    ),
    unusedServiceDays: remainingDays,
    windowEndsExclusive: input.firstDeliveredOn
      ? new Date(
          Date.parse(`${input.firstDeliveredOn}T00:00:00.000Z`) +
            input.refundWindowCalendarDays * 86_400_000,
        )
          .toISOString()
          .slice(0, 10)
      : null,
  };
}

export function renewalSchedule(
  currentEndDate: Date,
  noticeDays: number,
  timezone = 'Asia/Almaty',
) {
  const chargeAt = new Date(
    `${currentEndDate.toISOString().slice(0, 10)}T23:59:59.999+05:00`,
  );
  return {
    expectedChargeAt: chargeAt,
    notificationDueAt: new Date(chargeAt.getTime() - noticeDays * 86_400_000),
    timezone,
  };
}
