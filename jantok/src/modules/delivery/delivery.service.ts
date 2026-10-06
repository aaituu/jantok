import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DailyFulfillmentStatus,
  DeliveryAttemptStatus,
  DeliveryJobStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import {
  DELIVERY_PROVIDER,
  type DeliveryCreateRequest,
  type DeliveryProvider,
  type ProviderDeliveryStatus,
} from './delivery-provider.js';
import {
  isFinalFulfillmentStatus,
  mapProviderStatus,
  transitionRule,
  type TransitionActor,
} from './delivery-policy.js';
import { DeliveryZoneService } from './delivery-zone.service.js';
import type {
  DailyFulfillmentTransitionDto,
  DeliveryProviderEventDto,
} from './delivery.dto.js';

type AddressSnapshot = {
  streetAddress: string;
  apartment?: string | null;
  entrance?: string | null;
  floor?: string | null;
  intercom?: string | null;
  deliveryInstructions?: string | null;
  latitude: string | number;
  longitude: string | number;
  deliverySlotId?: string | null;
};
type SlotSnapshot = { startMinutes: number; endMinutes: number; code: string };

const providerProgress = [
  DailyFulfillmentStatus.READY,
  DailyFulfillmentStatus.DELIVERY_CREATED,
  DailyFulfillmentStatus.COURIER_ASSIGNED,
  DailyFulfillmentStatus.COURIER_PICKED_UP,
  DailyFulfillmentStatus.ON_THE_WAY,
  DailyFulfillmentStatus.ARRIVED,
  DailyFulfillmentStatus.DELIVERED,
] as const;

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly zone: DeliveryZoneService,
    @Inject(DELIVERY_PROVIDER) private readonly provider: DeliveryProvider,
  ) {}

  async ensureDailyFulfillment(serviceDayId: string) {
    const existing = await this.prisma.dailyFulfillment.findUnique({
      where: { serviceDayId },
    });
    if (existing) return existing;
    const day = await this.prisma.subscriptionServiceDay.findUnique({
      where: { id: serviceDayId },
      include: {
        subscription: { include: { household: true } },
        addressOverride: true,
        orders: { take: 1, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!day || day.orders.length === 0)
      throw new NotFoundException(
        'Paid service day with meal orders not found',
      );
    const settings = await this.zone.settings();
    const address = day.addressOverride
      ? (day.addressOverride.addressSnapshot as AddressSnapshot)
      : (day.orders[0]!.addressSnapshot as AddressSnapshot);
    const slot = day.addressOverride
      ? (day.addressOverride.slotSnapshot as SlotSnapshot)
      : await this.defaultSlotSnapshot(
          day.subscription.householdId,
          address.deliverySlotId,
        );
    if (address.latitude == null || address.longitude == null)
      throw new BadRequestException({
        code: 'DELIVERY_COORDINATES_REQUIRED',
        message:
          'Delivery coordinates are required even when phone geolocation is disabled',
      });
    await this.zone.assertDeliverable(
      Number(address.latitude),
      Number(address.longitude),
    );
    const dispatchAt = this.dispatchAt(
      day.serviceDate,
      slot.startMinutes,
      settings.dispatchLeadMinutes,
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.dailyFulfillment.create({
          data: {
            householdId: day.subscription.householdId,
            subscriptionId: day.subscriptionId,
            serviceDayId: day.id,
            serviceDate: day.serviceDate,
            addressSnapshot: address as Prisma.InputJsonValue,
            slotSnapshot: slot as Prisma.InputJsonValue,
            dispatchAt,
            financialStatus:
              day.subscription.status === 'ACTIVE' ? 'PAID' : 'UNPAID',
            events: {
              create: {
                idempotencyKey: `fulfillment:generated:${day.id}`,
                type: 'GENERATED',
                toStatus: DailyFulfillmentStatus.SCHEDULED,
                actorType: 'SYSTEM',
              },
            },
          },
        });
        await tx.dailyOrder.updateMany({
          where: { serviceDayId: day.id },
          data: { dailyFulfillmentId: created.id },
        });
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return this.prisma.dailyFulfillment.findUniqueOrThrow({
          where: { serviceDayId },
        });
      throw error;
    }
  }

  async generateMissing(limit = 100) {
    const days = await this.prisma.subscriptionServiceDay.findMany({
      where: {
        status: 'PLANNED',
        dailyFulfillment: null,
        orders: { some: {} },
        subscription: { status: 'ACTIVE' },
      },
      select: { id: true },
      orderBy: { serviceDate: 'asc' },
      take: limit,
    });
    const generated = [];
    for (const day of days)
      generated.push(await this.ensureDailyFulfillment(day.id));
    return { generated: generated.length };
  }

  async transition(
    fulfillmentId: string,
    dto: DailyFulfillmentTransitionDto,
    actor: TransitionActor,
    actorUserId?: string,
  ) {
    const duplicate = await this.prisma.dailyFulfillmentEvent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { fulfillment: true },
    });
    if (duplicate) return duplicate.fulfillment;
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.dailyFulfillment.findUniqueOrThrow({
        where: { id: fulfillmentId },
      });
      if (current.version !== dto.expectedVersion)
        throw new ConflictException({
          code: 'STALE_DAILY_ORDER_VERSION',
          message: 'Daily order was changed by another device or job',
        });
      if (!transitionRule(current.status, dto.to, actor))
        throw new ConflictException({
          code: 'DAILY_ORDER_TRANSITION_FORBIDDEN',
          message: `${actor} cannot transition ${current.status} to ${dto.to}`,
        });
      if (actor === 'STAFF' && !dto.reason.trim())
        throw new BadRequestException(
          'A reason is required for staff commands',
        );
      const changed = await tx.dailyFulfillment.updateMany({
        where: {
          id: fulfillmentId,
          version: dto.expectedVersion,
          status: current.status,
        },
        data: { status: dto.to, version: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new ConflictException({
          code: 'STALE_DAILY_ORDER_VERSION',
          message: 'Concurrent update detected',
        });
      await tx.dailyFulfillmentEvent.create({
        data: {
          fulfillmentId,
          idempotencyKey: dto.idempotencyKey,
          type: 'STATUS_TRANSITION',
          fromStatus: current.status,
          toStatus: dto.to,
          actorType: actor,
          actorUserId,
          reason: dto.reason,
        },
      });
      if (dto.to === DailyFulfillmentStatus.DELIVERED) {
        await tx.subscriptionServiceDay.update({
          where: { id: current.serviceDayId },
          data: { status: 'DELIVERED' },
        });
        await tx.dailyOrder.updateMany({
          where: { dailyFulfillmentId: current.id },
          data: { status: 'DELIVERED' },
        });
      }
      if (dto.to === DailyFulfillmentStatus.READY) {
        const settings = await tx.deliverySettings.findFirst({
          orderBy: { version: 'desc' },
        });
        await tx.deliveryJob.upsert({
          where: { fulfillmentId },
          create: {
            fulfillmentId,
            idempotencyKey: `delivery:create:${fulfillmentId}:1`,
            dispatchAt: current.dispatchAt,
            nextAttemptAt: current.dispatchAt,
            maxAttempts: settings?.maxCreateRetries ?? 3,
          },
          update: {
            dispatchAt: current.dispatchAt,
            nextAttemptAt: current.dispatchAt,
            status: DeliveryJobStatus.SCHEDULED,
          },
        });
      }
      return tx.dailyFulfillment.findUniqueOrThrow({
        where: { id: fulfillmentId },
      });
    });
  }

  async runMaintenance(now = new Date()) {
    const generated = await this.generateMissing();
    const finalized = await this.finalizeDue(now);
    const jobs = await this.prisma.deliveryJob.findMany({
      where: {
        status: { in: [DeliveryJobStatus.SCHEDULED, DeliveryJobStatus.RETRY] },
        dispatchAt: { lte: now },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      select: { id: true },
      orderBy: { dispatchAt: 'asc' },
      take: 50,
    });
    let processed = 0;
    for (const job of jobs) {
      if (await this.processJob(job.id, now)) processed += 1;
    }
    const reconciled = await this.reconcileActive(now);
    return { ...generated, finalized, processed, reconciled };
  }

  async finalizeDue(now = new Date()) {
    const candidates = await this.prisma.dailyFulfillment.findMany({
      where: { status: DailyFulfillmentStatus.SCHEDULED },
      select: { id: true, serviceDate: true },
      orderBy: { serviceDate: 'asc' },
      take: 200,
    });
    let finalized = 0;
    for (const candidate of candidates) {
      // Stage 2's default customer-change cutoff is 15:00 on the prior
      // business day. The persisted event makes repeated worker runs harmless.
      const date = candidate.serviceDate.toISOString().slice(0, 10);
      const lockAt = new Date(
        new Date(`${date}T15:00:00+05:00`).getTime() - 24 * 60 * 60_000,
      );
      if (lockAt > now) continue;
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.dailyFulfillment.updateMany({
          where: { id: candidate.id, status: DailyFulfillmentStatus.SCHEDULED },
          data: {
            status: DailyFulfillmentStatus.LOCKED,
            version: { increment: 1 },
          },
        });
        if (changed.count === 0) return;
        await tx.dailyFulfillmentEvent.create({
          data: {
            fulfillmentId: candidate.id,
            idempotencyKey: `fulfillment:locked:${candidate.id}`,
            type: 'STATUS_TRANSITION',
            fromStatus: DailyFulfillmentStatus.SCHEDULED,
            toStatus: DailyFulfillmentStatus.LOCKED,
            actorType: 'SYSTEM',
            reason: 'Daily order finalization cutoff reached',
          },
        });
        finalized += 1;
      });
    }
    return finalized;
  }

  async processJob(jobId: string, now = new Date()) {
    const claimed = await this.prisma.deliveryJob.updateMany({
      where: {
        id: jobId,
        status: { in: [DeliveryJobStatus.SCHEDULED, DeliveryJobStatus.RETRY] },
        dispatchAt: { lte: now },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      data: {
        status: DeliveryJobStatus.PROCESSING,
        lockedAt: now,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return false;
    const job = await this.prisma.deliveryJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { fulfillment: { include: { deliveryAttempts: true } } },
    });
    if (job.fulfillment.status !== DailyFulfillmentStatus.READY) {
      await this.prisma.deliveryJob.update({
        where: { id: job.id },
        data: {
          status: DeliveryJobStatus.CANCELLED,
          lastError: 'Fulfillment is no longer READY',
        },
      });
      return false;
    }
    const active = job.fulfillment.deliveryAttempts.find(
      (attempt) => !attempt.terminalAt,
    );
    const request = this.providerRequest(job.fulfillment, job.idempotencyKey);
    try {
      const attempt =
        active ??
        (await this.prisma.deliveryAttempt.create({
          data: {
            fulfillmentId: job.fulfillmentId,
            attemptNumber: 1,
            provider: this.provider.name,
            idempotencyKey: job.idempotencyKey,
            requestSnapshot: request as unknown as Prisma.InputJsonValue,
          },
        }));
      await this.provider.calculateDelivery(request);
      const result = await this.provider.createDelivery(request);
      await this.prisma.$transaction(async (tx) => {
        await tx.deliveryAttempt.update({
          where: { id: attempt.id },
          data: {
            providerReference: result.providerReference,
            providerStatus: result.status,
            providerUpdatedAt: new Date(result.updatedAt),
            status: DeliveryAttemptStatus.CREATED,
            responseSnapshot: (result.raw ?? {}) as Prisma.InputJsonValue,
          },
        });
        const current = await tx.dailyFulfillment.findUniqueOrThrow({
          where: { id: job.fulfillmentId },
        });
        if (current.status === DailyFulfillmentStatus.READY) {
          await tx.dailyFulfillment.update({
            where: { id: current.id },
            data: {
              status: DailyFulfillmentStatus.DELIVERY_CREATED,
              version: { increment: 1 },
            },
          });
          await tx.dailyFulfillmentEvent.create({
            data: {
              fulfillmentId: current.id,
              idempotencyKey: `${job.idempotencyKey}:created`,
              type: 'STATUS_TRANSITION',
              fromStatus: current.status,
              toStatus: DailyFulfillmentStatus.DELIVERY_CREATED,
              actorType: 'SYSTEM',
              reason: 'Scheduled provider delivery created',
            },
          });
        }
        await tx.deliveryJob.update({
          where: { id: job.id },
          data: {
            status: DeliveryJobStatus.COMPLETED,
            lastError: null,
            lockedAt: null,
          },
        });
      });
      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : 'Unknown provider error';
      const exhausted = job.attempts >= job.maxAttempts;
      const settings = await this.zone.settings();
      await this.prisma.deliveryJob.update({
        where: { id: job.id },
        data: {
          status: exhausted
            ? DeliveryJobStatus.FAILED
            : DeliveryJobStatus.RETRY,
          nextAttemptAt: exhausted
            ? null
            : new Date(
                now.getTime() +
                  settings.retryBaseSeconds *
                    2 ** Math.max(0, job.attempts - 1) *
                    1000,
              ),
          lastError: message,
          lockedAt: null,
        },
      });
      return false;
    }
  }

  async reconcileActive(now = new Date()) {
    const settings = await this.zone.settings();
    const attempts = await this.prisma.deliveryAttempt.findMany({
      where: { terminalAt: null, providerReference: { not: null } },
      take: 100,
      orderBy: { updatedAt: 'asc' },
    });
    let count = 0;
    for (const attempt of attempts) {
      try {
        const result = await this.provider.getStatus(
          attempt.providerReference!,
        );
        await this.applyProviderResult(
          attempt.id,
          `poll:${attempt.id}:${result.updatedAt}`,
          result,
          now,
        );
        const [courier, tracking, eta] = await Promise.all([
          settings.courierPhoneEnabled || settings.courierLocationEnabled
            ? this.provider.getCourier(attempt.providerReference!)
            : null,
          settings.trackingLinkEnabled || settings.courierLocationEnabled
            ? this.provider.getTracking(attempt.providerReference!)
            : null,
          settings.etaEnabled
            ? this.provider.getETA(attempt.providerReference!)
            : null,
        ]);
        await this.prisma.deliveryAttempt.update({
          where: { id: attempt.id },
          data: {
            courierSnapshot: courier
              ? (courier as unknown as Prisma.InputJsonValue)
              : undefined,
            trackingSnapshot: tracking
              ? (tracking as unknown as Prisma.InputJsonValue)
              : undefined,
            etaSnapshot: eta
              ? (eta as unknown as Prisma.InputJsonValue)
              : undefined,
          },
        });
        count += 1;
      } catch {
        // A later run retries reconciliation; never create another courier here.
      }
    }
    return count;
  }

  async acceptProviderEvent(dto: DeliveryProviderEventDto) {
    const attempt = await this.prisma.deliveryAttempt.findUnique({
      where: { providerReference: dto.providerReference },
    });
    if (!attempt) throw new NotFoundException('Delivery attempt not found');
    return this.applyProviderResult(attempt.id, dto.eventId, {
      providerReference: dto.providerReference,
      status: dto.status,
      updatedAt: dto.updatedAt,
      terminal: [
        'delivered',
        'delivered_finish',
        'failed',
        'cancelled',
      ].includes(dto.status.toLowerCase()),
      raw: dto.payload,
    });
  }

  private async applyProviderResult(
    attemptId: string,
    eventId: string,
    result: ProviderDeliveryStatus,
    now = new Date(),
  ) {
    const duplicate = await this.prisma.deliveryProviderEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: this.provider.name,
          providerEventId: eventId,
        },
      },
    });
    if (duplicate) return { duplicate: true, result: duplicate.result };
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.deliveryAttempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: { fulfillment: true },
      });
      const updatedAt = new Date(result.updatedAt);
      const stale = Boolean(
        attempt.providerUpdatedAt && updatedAt < attempt.providerUpdatedAt,
      );
      const target = mapProviderStatus(result.status);
      const ignored =
        stale ||
        !target ||
        isFinalFulfillmentStatus(attempt.fulfillment.status);
      await tx.deliveryProviderEvent.create({
        data: {
          deliveryAttemptId: attempt.id,
          provider: this.provider.name,
          providerEventId: eventId,
          providerStatus: result.status,
          providerUpdatedAt: updatedAt,
          result: ignored ? (stale ? 'IGNORED_STALE' : 'IGNORED') : 'PROCESSED',
          payload: (result.raw ?? {}) as Prisma.InputJsonValue,
        },
      });
      if (ignored)
        return {
          duplicate: false,
          result: stale ? 'IGNORED_STALE' : 'IGNORED',
        };
      await tx.deliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          providerStatus: result.status,
          providerUpdatedAt: updatedAt,
          status: this.attemptStatus(target!),
          terminalAt: result.terminal ? now : null,
        },
      });
      await this.advanceProviderState(
        tx,
        attempt.fulfillment,
        target!,
        eventId,
      );
      return { duplicate: false, result: 'PROCESSED' };
    });
  }

  private async advanceProviderState(
    tx: Prisma.TransactionClient,
    fulfillment: {
      id: string;
      status: DailyFulfillmentStatus;
      version: number;
    },
    target: DailyFulfillmentStatus,
    eventId: string,
  ) {
    let from = fulfillment.status;
    if (
      target === DailyFulfillmentStatus.DELIVERY_FAILED ||
      target === DailyFulfillmentStatus.NO_ANSWER
    ) {
      if (!transitionRule(from, target, 'DELIVERY_PROVIDER')) return;
      await this.providerTransition(
        tx,
        fulfillment.id,
        from,
        target,
        eventId,
        0,
      );
      return;
    }
    const fromIndex = providerProgress.indexOf(
      from as (typeof providerProgress)[number],
    );
    const targetIndex = providerProgress.indexOf(
      target as (typeof providerProgress)[number],
    );
    if (fromIndex < 0 || targetIndex <= fromIndex) return;
    for (let index = fromIndex + 1; index <= targetIndex; index += 1) {
      const to = providerProgress[index]!;
      if (
        !transitionRule(
          from,
          to,
          to === DailyFulfillmentStatus.DELIVERY_CREATED
            ? 'SYSTEM'
            : 'DELIVERY_PROVIDER',
        )
      )
        continue;
      await this.providerTransition(
        tx,
        fulfillment.id,
        from,
        to,
        eventId,
        index,
      );
      from = to;
    }
  }

  private async providerTransition(
    tx: Prisma.TransactionClient,
    fulfillmentId: string,
    from: DailyFulfillmentStatus,
    to: DailyFulfillmentStatus,
    eventId: string,
    index: number,
  ) {
    await tx.dailyFulfillment.update({
      where: { id: fulfillmentId },
      data: { status: to, version: { increment: 1 } },
    });
    await tx.dailyFulfillmentEvent.create({
      data: {
        fulfillmentId,
        idempotencyKey: `provider:${this.provider.name}:${eventId}:${index}`,
        type: 'PROVIDER_STATUS',
        fromStatus: from,
        toStatus: to,
        actorType: 'DELIVERY_PROVIDER',
        reason: 'Mapped authoritative provider status',
      },
    });
    if (to === DailyFulfillmentStatus.DELIVERED) {
      const fulfillment = await tx.dailyFulfillment.findUniqueOrThrow({
        where: { id: fulfillmentId },
        select: { serviceDayId: true },
      });
      await tx.subscriptionServiceDay.update({
        where: { id: fulfillment.serviceDayId },
        data: { status: 'DELIVERED' },
      });
      await tx.dailyOrder.updateMany({
        where: { dailyFulfillmentId: fulfillmentId },
        data: { status: 'DELIVERED' },
      });
    }
  }

  async tracking(userId: string, fulfillmentId: string) {
    const fulfillment = await this.prisma.dailyFulfillment.findFirst({
      where: { id: fulfillmentId, household: { ownerUserId: userId } },
      include: {
        deliveryAttempts: { orderBy: { attemptNumber: 'desc' }, take: 1 },
      },
    });
    if (!fulfillment) throw new NotFoundException('Daily order not found');
    const settings = await this.zone.settings();
    const attempt = fulfillment.deliveryAttempts[0];
    return {
      id: fulfillment.id,
      serviceDate: fulfillment.serviceDate,
      status: fulfillment.status,
      financialStatus: fulfillment.financialStatus,
      address: fulfillment.addressSnapshot,
      slot: fulfillment.slotSnapshot,
      courier: settings.courierPhoneEnabled
        ? (attempt?.courierSnapshot ?? null)
        : null,
      tracking:
        settings.trackingLinkEnabled || settings.courierLocationEnabled
          ? (attempt?.trackingSnapshot ?? null)
          : null,
      eta: settings.etaEnabled ? (attempt?.etaSnapshot ?? null) : null,
      availability: {
        courier: settings.courierPhoneEnabled,
        tracking:
          settings.trackingLinkEnabled || settings.courierLocationEnabled,
        eta: settings.etaEnabled,
      },
      fallback: attempt
        ? 'Tracking data is temporarily unavailable; contact support.'
        : 'Delivery has not been dispatched yet.',
    };
  }

  async clientConfig() {
    const settings = await this.zone.settings();
    const slots = await this.prisma.deliverySlot.findMany({
      where: {
        status: {
          in:
            process.env.APP_ENV === 'production'
              ? ['ACTIVE']
              : ['ACTIVE', 'DEMO'],
        },
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        startMinutes: true,
        endMinutes: true,
        status: true,
      },
    });
    return {
      maxSavedAddresses: settings.maxSavedAddresses,
      businessTimezone: settings.businessTimezone,
      slots: slots.map((slot) => ({
        ...slot,
        feeKzt: 0,
        capacityCap: null,
      })),
      zoneMode: process.env.APP_ENV === 'production' ? 'CONFIRMED' : 'DEMO',
      manualCoordinatesRequired: true,
    };
  }

  async updateFinancialState(
    fulfillmentId: string,
    status: 'PARTIALLY_REFUNDED' | 'REFUNDED',
    idempotencyKey: string,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const fulfillment = await tx.dailyFulfillment.update({
        where: { id: fulfillmentId },
        data: { financialStatus: status, version: { increment: 1 } },
      });
      await tx.dailyFulfillmentEvent.create({
        data: {
          fulfillmentId,
          idempotencyKey,
          type: 'FINANCIAL_STATE_CHANGED',
          actorType: 'SYSTEM',
          reason,
          details: { financialStatus: status },
        },
      });
      return fulfillment;
    });
  }

  private async defaultSlotSnapshot(
    householdId: string,
    deliverySlotId?: string | null,
  ): Promise<SlotSnapshot> {
    const snapshotSlot = deliverySlotId
      ? await this.prisma.deliverySlot.findUnique({
          where: { id: deliverySlotId },
        })
      : null;
    const address = await this.prisma.householdAddress.findFirst({
      where: { householdId, isDefault: true, deletedAt: null },
      include: { deliverySlot: true },
    });
    const slot =
      snapshotSlot ??
      address?.deliverySlot ??
      (await this.prisma.deliverySlot.findFirst({
        where: { status: { in: ['ACTIVE', 'DEMO'] } },
        orderBy: { sortOrder: 'asc' },
      }));
    if (!slot) throw new BadRequestException('Delivery slot is not configured');
    return {
      code: slot.code,
      startMinutes: slot.startMinutes,
      endMinutes: slot.endMinutes,
    };
  }

  private dispatchAt(
    serviceDate: Date,
    startMinutes: number,
    leadMinutes: number,
  ) {
    const date = serviceDate.toISOString().slice(0, 10);
    const minutes = startMinutes - leadMinutes;
    const localMidnightUtc = new Date(`${date}T00:00:00+05:00`).getTime();
    return new Date(localMidnightUtc + minutes * 60_000);
  }

  private providerRequest(
    fulfillment: {
      addressSnapshot: Prisma.JsonValue;
      dispatchAt: Date;
      id: string;
    },
    idempotencyKey: string,
  ): DeliveryCreateRequest {
    const address = fulfillment.addressSnapshot as AddressSnapshot;
    const pickupLongitude = Number(
      process.env.DELIVERY_PICKUP_LONGITUDE ?? '71.4304',
    );
    const pickupLatitude = Number(
      process.env.DELIVERY_PICKUP_LATITUDE ?? '51.1282',
    );
    return {
      idempotencyKey,
      due: fulfillment.dispatchAt.toISOString(),
      pickup: {
        coordinates: [pickupLongitude, pickupLatitude],
        address: process.env.DELIVERY_PICKUP_ADDRESS ?? 'JANTOK DEMO KITCHEN',
      },
      destination: {
        coordinates: [Number(address.longitude), Number(address.latitude)],
        address: address.streetAddress,
        entrance: address.entrance ?? undefined,
        floor: address.floor ?? undefined,
        apartment: address.apartment ?? undefined,
        intercom: address.intercom ?? undefined,
        instructions: address.deliveryInstructions ?? undefined,
      },
      comment: `JANTOK daily order ${fulfillment.id}`,
    };
  }

  private attemptStatus(status: DailyFulfillmentStatus): DeliveryAttemptStatus {
    const map: Partial<Record<DailyFulfillmentStatus, DeliveryAttemptStatus>> =
      {
        DELIVERY_CREATED: DeliveryAttemptStatus.CREATED,
        COURIER_ASSIGNED: DeliveryAttemptStatus.COURIER_ASSIGNED,
        COURIER_PICKED_UP: DeliveryAttemptStatus.PICKED_UP,
        ON_THE_WAY: DeliveryAttemptStatus.ON_THE_WAY,
        ARRIVED: DeliveryAttemptStatus.ARRIVED,
        DELIVERED: DeliveryAttemptStatus.DELIVERED,
        NO_ANSWER: DeliveryAttemptStatus.NO_ANSWER,
        DELIVERY_FAILED: DeliveryAttemptStatus.FAILED,
      };
    return map[status] ?? DeliveryAttemptStatus.UNKNOWN;
  }
}
