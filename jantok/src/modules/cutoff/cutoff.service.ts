import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BusinessRuleStatus, type CutoffPolicy } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';

export type CutoffKind =
  | 'menu'
  | 'payment'
  | 'skip'
  | 'address'
  | 'delivery'
  | 'standaloneAddon'
  | 'kitchenLock';

const minuteFields: Record<CutoffKind, keyof CutoffPolicy> = {
  menu: 'menuMinutes',
  payment: 'paymentMinutes',
  skip: 'skipMinutes',
  address: 'addressMinutes',
  delivery: 'deliveryMinutes',
  standaloneAddon: 'standaloneAddonMinutes',
  kitchenLock: 'kitchenLockMinutes',
};

export function almatyDeadline(serviceDate: string, minutes: number): Date {
  const [year, month, day] = serviceDate.split('-').map(Number);
  const previousLocalMidnightUtc =
    Date.UTC(year, month - 1, day - 1) - 5 * 3600000;
  return new Date(previousLocalMidnightUtc + minutes * 60000);
}

export function cutoffDecision(
  serviceDate: string,
  minutes: number,
  now: Date,
) {
  const deadline = almatyDeadline(serviceDate, minutes);
  const [year, month, day] = serviceDate.split('-').map(Number);
  return {
    allowed: now.getTime() < deadline.getTime(),
    deadline,
    nextEligibleDate: new Date(Date.UTC(year, month - 1, day) + 86400000)
      .toISOString()
      .slice(0, 10),
  };
}

@Injectable()
export class CutoffService {
  constructor(private readonly prisma: PrismaService) {}

  async currentPolicy(at = new Date()) {
    const status =
      process.env.APP_ENV === 'production'
        ? BusinessRuleStatus.ACTIVE
        : BusinessRuleStatus.DEMO;
    const policy = await this.prisma.cutoffPolicy.findFirst({
      where: {
        status,
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }],
      },
      orderBy: { version: 'desc' },
    });
    if (!policy)
      throw new UnprocessableEntityException({
        code: 'CUTOFF_POLICY_UNAVAILABLE',
        message: 'No active cutoff policy is configured',
      });
    return policy;
  }

  decide(
    policy: CutoffPolicy,
    kind: CutoffKind,
    serviceDate: string,
    now = new Date(),
  ) {
    return cutoffDecision(serviceDate, Number(policy[minuteFields[kind]]), now);
  }

  assertOpen(
    policy: CutoffPolicy,
    kind: CutoffKind,
    serviceDate: string,
    now = new Date(),
  ) {
    const result = this.decide(policy, kind, serviceDate, now);
    if (!result.allowed)
      throw new UnprocessableEntityException({
        code: 'CUTOFF_CLOSED',
        message: `${kind} changes are closed for ${serviceDate}`,
        details: {
          kind,
          deadline: result.deadline.toISOString(),
          nextEligibleDate: result.nextEligibleDate,
        },
      });
    return result;
  }
}
