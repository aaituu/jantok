import { describe, expect, it } from 'vitest';
import { DailyFulfillmentStatus as S } from '@prisma/client';
import {
  isFinalFulfillmentStatus,
  mapProviderStatus,
  transitionRule,
} from './delivery-policy.js';

describe('daily fulfillment policy', () => {
  it('keeps failure/no-answer distinct from delivered', () => {
    expect(isFinalFulfillmentStatus(S.NO_ANSWER)).toBe(true);
    expect(isFinalFulfillmentStatus(S.DELIVERY_FAILED)).toBe(true);
    expect(mapProviderStatus('failed')).toBe(S.DELIVERY_FAILED);
    expect(mapProviderStatus('failed')).not.toBe(S.DELIVERED);
  });

  it('does not allow final-state regression', () => {
    expect(
      transitionRule(S.DELIVERED, S.ON_THE_WAY, 'DELIVERY_PROVIDER'),
    ).toBeUndefined();
    expect(
      transitionRule(S.NO_ANSWER, S.DELIVERED, 'DELIVERY_PROVIDER'),
    ).toBeUndefined();
  });

  it('requires an explicit permitted actor', () => {
    expect(transitionRule(S.PACKING, S.READY, 'KITCHEN')).toBeDefined();
    expect(
      transitionRule(S.PACKING, S.READY, 'DELIVERY_PROVIDER'),
    ).toBeUndefined();
  });
});
