import { describe, expect, it } from 'vitest';
import { calculateStandardRefund, renewalSchedule } from './payment-policy.js';

const base = {
  paidCashKzt: 27_000,
  paidBonusKzt: 3_000,
  alreadyRefundedCashKzt: 0,
  alreadyRefundedBonusKzt: 0,
  paidServiceDays: 30,
  usedServiceDays: 0,
  firstDeliveredOn: null,
  requestedOn: '2026-09-24',
  refundWindowCalendarDays: 7,
};

describe('refund policy', () => {
  it('returns the complete remaining bank and bonus portions before delivery', () => {
    expect(calculateStandardRefund(base)).toMatchObject({
      allowed: true,
      kind: 'BEFORE_FIRST_DELIVERY',
      cashKzt: 27_000,
      bonusKzt: 3_000,
      unusedServiceDays: 30,
    });
  });

  it('prorates unused service days inside the seven calendar day window', () => {
    expect(
      calculateStandardRefund({
        ...base,
        firstDeliveredOn: '2026-09-20',
        requestedOn: '2026-09-26',
        usedServiceDays: 6,
      }),
    ).toMatchObject({
      allowed: true,
      kind: 'UNUSED_WITHIN_WINDOW',
      cashKzt: 21_600,
      bonusKzt: 2_400,
      unusedServiceDays: 24,
      windowEndsExclusive: '2026-09-27',
    });
  });

  it('treats the exact seventh-day boundary as closed', () => {
    expect(
      calculateStandardRefund({
        ...base,
        firstDeliveredOn: '2026-09-20',
        requestedOn: '2026-09-27',
        usedServiceDays: 7,
      }),
    ).toEqual({
      allowed: false,
      code: 'REFUND_WINDOW_CLOSED',
      kind: 'UNUSED_WITHIN_WINDOW',
    });
  });

  it('never exceeds the not-yet-refunded captured amount', () => {
    expect(
      calculateStandardRefund({
        ...base,
        alreadyRefundedCashKzt: 20_000,
        alreadyRefundedBonusKzt: 2_500,
      }),
    ).toMatchObject({ cashKzt: 7_000, bonusKzt: 500 });
  });
});

describe('renewal schedule', () => {
  it('moves with the actual paid service end date', () => {
    const original = renewalSchedule(new Date('2026-10-20T00:00:00Z'), 4);
    const extended = renewalSchedule(new Date('2026-10-23T00:00:00Z'), 4);
    expect(
      extended.expectedChargeAt.getTime() - original.expectedChargeAt.getTime(),
    ).toBe(3 * 86_400_000);
    expect(
      extended.notificationDueAt.getTime() -
        original.notificationDueAt.getTime(),
    ).toBe(3 * 86_400_000);
  });
});
