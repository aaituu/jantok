import { DailyFulfillmentStatus } from '@prisma/client';

export type TransitionActor =
  'SYSTEM' | 'KITCHEN' | 'DELIVERY_PROVIDER' | 'STAFF';

export type TransitionRule = {
  from: DailyFulfillmentStatus;
  to: DailyFulfillmentStatus;
  actors: readonly TransitionActor[];
  retryable: boolean;
};

const s = DailyFulfillmentStatus;
export const DAILY_FULFILLMENT_TRANSITIONS: readonly TransitionRule[] = [
  { from: s.SCHEDULED, to: s.LOCKED, actors: ['SYSTEM'], retryable: true },
  {
    from: s.LOCKED,
    to: s.IN_PRODUCTION,
    actors: ['KITCHEN', 'STAFF'],
    retryable: true,
  },
  {
    from: s.IN_PRODUCTION,
    to: s.COOKED,
    actors: ['KITCHEN', 'STAFF'],
    retryable: true,
  },
  {
    from: s.COOKED,
    to: s.PACKING,
    actors: ['KITCHEN', 'STAFF'],
    retryable: true,
  },
  {
    from: s.PACKING,
    to: s.READY,
    actors: ['KITCHEN', 'STAFF'],
    retryable: true,
  },
  {
    from: s.READY,
    to: s.DELIVERY_CREATED,
    actors: ['SYSTEM'],
    retryable: true,
  },
  {
    from: s.DELIVERY_CREATED,
    to: s.COURIER_ASSIGNED,
    actors: ['DELIVERY_PROVIDER'],
    retryable: true,
  },
  {
    from: s.COURIER_ASSIGNED,
    to: s.COURIER_PICKED_UP,
    actors: ['DELIVERY_PROVIDER'],
    retryable: true,
  },
  {
    from: s.COURIER_PICKED_UP,
    to: s.ON_THE_WAY,
    actors: ['DELIVERY_PROVIDER'],
    retryable: true,
  },
  {
    from: s.ON_THE_WAY,
    to: s.ARRIVED,
    actors: ['DELIVERY_PROVIDER'],
    retryable: true,
  },
  {
    from: s.ARRIVED,
    to: s.DELIVERED,
    actors: ['DELIVERY_PROVIDER', 'STAFF'],
    retryable: true,
  },
  {
    from: s.COURIER_ASSIGNED,
    to: s.NO_ANSWER,
    actors: ['DELIVERY_PROVIDER', 'STAFF'],
    retryable: true,
  },
  {
    from: s.ON_THE_WAY,
    to: s.NO_ANSWER,
    actors: ['DELIVERY_PROVIDER', 'STAFF'],
    retryable: true,
  },
  {
    from: s.ARRIVED,
    to: s.NO_ANSWER,
    actors: ['DELIVERY_PROVIDER', 'STAFF'],
    retryable: true,
  },
  {
    from: s.READY,
    to: s.DELIVERY_FAILED,
    actors: ['SYSTEM', 'STAFF'],
    retryable: true,
  },
  {
    from: s.DELIVERY_CREATED,
    to: s.DELIVERY_FAILED,
    actors: ['DELIVERY_PROVIDER', 'STAFF'],
    retryable: true,
  },
  {
    from: s.COURIER_ASSIGNED,
    to: s.DELIVERY_FAILED,
    actors: ['DELIVERY_PROVIDER', 'STAFF'],
    retryable: true,
  },
  {
    from: s.COURIER_PICKED_UP,
    to: s.DELIVERY_FAILED,
    actors: ['DELIVERY_PROVIDER', 'STAFF'],
    retryable: true,
  },
  {
    from: s.ON_THE_WAY,
    to: s.DELIVERY_FAILED,
    actors: ['DELIVERY_PROVIDER', 'STAFF'],
    retryable: true,
  },
  {
    from: s.ARRIVED,
    to: s.DELIVERY_FAILED,
    actors: ['DELIVERY_PROVIDER', 'STAFF'],
    retryable: true,
  },
  {
    from: s.SCHEDULED,
    to: s.SKIPPED,
    actors: ['SYSTEM', 'STAFF'],
    retryable: true,
  },
  {
    from: s.SCHEDULED,
    to: s.CANCELLED,
    actors: ['SYSTEM', 'STAFF'],
    retryable: true,
  },
  { from: s.LOCKED, to: s.CANCELLED, actors: ['STAFF'], retryable: true },
] as const;

const finalStatuses = new Set<DailyFulfillmentStatus>([
  s.DELIVERED,
  s.SKIPPED,
  s.CANCELLED,
  s.DELIVERY_FAILED,
  s.NO_ANSWER,
]);

export function isFinalFulfillmentStatus(status: DailyFulfillmentStatus) {
  return finalStatuses.has(status);
}

export function transitionRule(
  from: DailyFulfillmentStatus,
  to: DailyFulfillmentStatus,
  actor: TransitionActor,
) {
  return DAILY_FULFILLMENT_TRANSITIONS.find(
    (rule) =>
      rule.from === from && rule.to === to && rule.actors.includes(actor),
  );
}

export function mapProviderStatus(status: string) {
  const normalized = status.toLowerCase();
  const mapping: Record<string, DailyFulfillmentStatus | undefined> = {
    accepted: s.DELIVERY_CREATED,
    performer_lookup: s.DELIVERY_CREATED,
    performer_draft: s.DELIVERY_CREATED,
    performer_found: s.COURIER_ASSIGNED,
    pickup_arrived: s.COURIER_ASSIGNED,
    ready_for_pickup_confirmation: s.COURIER_ASSIGNED,
    pickuped: s.COURIER_PICKED_UP,
    delivery_arrived: s.ARRIVED,
    ready_for_delivery_confirmation: s.ARRIVED,
    delivered: s.DELIVERED,
    delivered_finish: s.DELIVERED,
    failed: s.DELIVERY_FAILED,
  };
  return mapping[normalized];
}
