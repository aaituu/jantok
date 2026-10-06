import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BusinessRuleStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreateSystemSettingDto } from './settings.dto.js';

const SECRET =
  /(secret|password|token|credential|api.?key|private.?key|signing)/i;
const ACTIVE_RULE_STATUS = () =>
  process.env.APP_ENV === 'production'
    ? BusinessRuleStatus.ACTIVE
    : BusinessRuleStatus.DEMO;

function assertNoSecrets(value: unknown, path = 'value') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET.test(key))
      throw new UnprocessableEntityException({
        code: 'SECRET_IN_GENERAL_SETTINGS',
        message: `Provider secrets are forbidden in System Settings (${path}.${key})`,
      });
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function integer(value: unknown, key: string, minimum = 0) {
  if (!Number.isInteger(value) || Number(value) < minimum)
    throw new UnprocessableEntityException(
      `${key} must be an integer >= ${minimum}`,
    );
  return Number(value);
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async runtime() {
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        status: 'APPROVED',
        OR: [{ effectiveAt: null }, { effectiveAt: { lte: new Date() } }],
      },
      orderBy: [{ groupCode: 'asc' }, { key: 'asc' }, { version: 'desc' }],
    });
    const values: Record<string, Record<string, unknown>> = {};
    for (const row of rows) {
      values[row.groupCode] ??= {};
      if (!(row.key in values[row.groupCode]))
        values[row.groupCode][row.key] = row.value;
    }
    const [cutoff, pricing, club, delivery] = await Promise.all([
      this.prisma.cutoffPolicy.findFirst({
        where: { status: ACTIVE_RULE_STATUS() },
        orderBy: { version: 'desc' },
      }),
      this.prisma.pricingRuleSet.findFirst({
        where: { status: ACTIVE_RULE_STATUS() },
        orderBy: { version: 'desc' },
      }),
      this.prisma.clubTier.findMany({
        where: { status: ACTIVE_RULE_STATUS() },
        orderBy: { thresholdPaidCycles: 'asc' },
      }),
      this.prisma.deliverySettings.findFirst({
        where: {
          status: process.env.APP_ENV === 'production' ? 'ACTIVE' : 'DEMO',
        },
        orderBy: { version: 'desc' },
      }),
    ]);
    return {
      revision: rows.reduce((max, row) => Math.max(max, row.version), 0),
      generatedAt: new Date(),
      businessTimezone: cutoff?.timezone ?? 'Asia/Almaty',
      values,
      effective: {
        cutoff,
        pricing,
        club: club.map((tier) => ({
          code: tier.code,
          names: { kk: tier.nameKk, ru: tier.nameRu, en: tier.nameEn },
          thresholdPaidCycles: tier.thresholdPaidCycles,
          bonusMultiplierBps: tier.bonusMultiplierBps,
          benefits: tier.benefits,
        })),
        delivery: delivery
          ? {
              maxSavedAddresses: delivery.maxSavedAddresses,
              businessTimezone: delivery.businessTimezone,
            }
          : null,
      },
    };
  }

  list(groupCode?: string) {
    return this.prisma.systemSetting.findMany({
      where: groupCode ? { groupCode } : {},
      orderBy: [{ groupCode: 'asc' }, { key: 'asc' }, { version: 'desc' }],
    });
  }

  async create(
    actorUserId: string,
    actorEmployeeId: string,
    dto: CreateSystemSettingDto,
    requestId: string,
  ) {
    assertNoSecrets(dto.value);
    const prior = await this.prisma.systemSetting.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (prior) return prior;
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.systemSetting.findFirst({
        where: { groupCode: dto.groupCode, key: dto.key },
        orderBy: { version: 'desc' },
      });
      if (dto.status === 'APPROVED') {
        await tx.systemSetting.updateMany({
          where: {
            groupCode: dto.groupCode,
            key: dto.key,
            status: 'APPROVED',
          },
          data: { status: 'RETIRED' },
        });
        await this.projectApprovedSetting(tx, dto);
      }
      const created = await tx.systemSetting.create({
        data: {
          groupCode: dto.groupCode,
          key: dto.key,
          version: (latest?.version ?? 0) + 1,
          status: dto.status,
          value: dto.value as Prisma.InputJsonValue,
          effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : null,
          idempotencyKey: dto.idempotencyKey,
        },
      });
      await this.audit.record(
        {
          actorUserId,
          actorEmployeeId,
          action: 'SYSTEM_SETTING_VERSION_CREATED',
          entityType: 'SystemSetting',
          entityId: created.id,
          oldValues: latest,
          newValues: created,
          reason: dto.reason,
          requestId,
        },
        tx,
      );
      return created;
    });
  }

  private async projectApprovedSetting(
    tx: Prisma.TransactionClient,
    dto: CreateSystemSettingDto,
  ) {
    if (dto.groupCode === 'CUTOFF' && dto.key === 'POLICY') {
      const value = dto.value;
      const latest = await tx.cutoffPolicy.findFirst({
        orderBy: { version: 'desc' },
      });
      const status = ACTIVE_RULE_STATUS();
      await tx.cutoffPolicy.create({
        data: {
          version: (latest?.version ?? 0) + 1,
          status,
          timezone: String(value.timezone ?? 'Asia/Almaty'),
          menuMinutes: integer(value.menuMinutes, 'menuMinutes'),
          paymentMinutes: integer(value.paymentMinutes, 'paymentMinutes'),
          skipMinutes: integer(value.skipMinutes, 'skipMinutes'),
          addressMinutes: integer(value.addressMinutes, 'addressMinutes'),
          deliveryMinutes: integer(value.deliveryMinutes, 'deliveryMinutes'),
          standaloneAddonMinutes: integer(
            value.standaloneAddonMinutes,
            'standaloneAddonMinutes',
          ),
          kitchenLockMinutes: integer(
            value.kitchenLockMinutes,
            'kitchenLockMinutes',
          ),
          serviceDaysPerCycle: integer(
            value.serviceDaysPerCycle,
            'serviceDaysPerCycle',
            1,
          ),
          maxPauseCalendarDays: integer(
            value.maxPauseCalendarDays,
            'maxPauseCalendarDays',
          ),
          effectiveFrom: dto.effectiveAt
            ? new Date(dto.effectiveAt)
            : new Date(),
        },
      });
    }
    if (dto.groupCode === 'PRICING' && dto.key === 'RULES') {
      const value = dto.value;
      const latest = await tx.pricingRuleSet.findFirst({
        orderBy: { version: 'desc' },
      });
      const status = ACTIVE_RULE_STATUS();
      await tx.pricingRuleSet.create({
        data: {
          version: (latest?.version ?? 0) + 1,
          status,
          adultMonthlyKzt: integer(value.adultMonthlyKzt, 'adultMonthlyKzt'),
          teenMonthlyKzt: integer(value.teenMonthlyKzt, 'teenMonthlyKzt'),
          childMonthlyKzt: integer(value.childMonthlyKzt, 'childMonthlyKzt'),
          infantMonthlyKzt: integer(value.infantMonthlyKzt, 'infantMonthlyKzt'),
          secondMemberDiscountBps: integer(
            value.secondMemberDiscountBps,
            'secondMemberDiscountBps',
          ),
          thirdPlusDiscountBps: integer(
            value.thirdPlusDiscountBps,
            'thirdPlusDiscountBps',
          ),
          guestDayKzt: integer(value.guestDayKzt, 'guestDayKzt'),
          effectiveFrom: dto.effectiveAt
            ? new Date(dto.effectiveAt)
            : new Date(),
        },
      });
    }
    if (dto.groupCode === 'CLUB' && dto.key === 'LEVELS') {
      const levels = dto.value.levels;
      if (!Array.isArray(levels) || levels.length === 0)
        throw new UnprocessableEntityException(
          'CLUB.LEVELS requires a non-empty levels array',
        );
      const status = ACTIVE_RULE_STATUS();
      for (const raw of levels) {
        if (!raw || typeof raw !== 'object')
          throw new UnprocessableEntityException(
            'Each CLUB level must be an object',
          );
        const level = raw as Record<string, unknown>;
        const code = String(level.code ?? '')
          .trim()
          .toUpperCase();
        if (!/^[A-Z0-9_]{2,64}$/.test(code))
          throw new UnprocessableEntityException('Invalid CLUB level code');
        await tx.clubTier.upsert({
          where: { code },
          create: {
            code,
            nameKk: String(level.nameKk ?? code),
            nameRu: String(level.nameRu ?? code),
            nameEn: String(level.nameEn ?? code),
            status,
            thresholdPaidCycles: integer(
              level.thresholdPaidCycles,
              'thresholdPaidCycles',
            ),
            bonusMultiplierBps: integer(
              level.bonusMultiplierBps ?? 10000,
              'bonusMultiplierBps',
            ),
            benefits: (level.benefits ?? {}) as Prisma.InputJsonValue,
          },
          update: {
            nameKk: String(level.nameKk ?? code),
            nameRu: String(level.nameRu ?? code),
            nameEn: String(level.nameEn ?? code),
            status,
            thresholdPaidCycles: integer(
              level.thresholdPaidCycles,
              'thresholdPaidCycles',
            ),
            bonusMultiplierBps: integer(
              level.bonusMultiplierBps ?? 10000,
              'bonusMultiplierBps',
            ),
            benefits: (level.benefits ?? {}) as Prisma.InputJsonValue,
          },
        });
      }
    }
  }
}
