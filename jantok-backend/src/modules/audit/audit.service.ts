import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';

const SECRET_KEY =
  /(secret|password|token|authorization|cookie|cvv|pan|private.?key|signing)/i;

export function redactAuditValue(value: unknown): Prisma.InputJsonValue {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? '[REDACTED]' : redactAuditValue(item),
      ]),
    ) as Prisma.InputJsonObject;
  if (value === undefined) return '[undefined]';
  return value as Prisma.InputJsonValue;
}

type AuditInput = {
  actorUserId?: string;
  actorEmployeeId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  reason?: string;
  requestId: string;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: AuditInput, tx: Prisma.TransactionClient = this.prisma) {
    return tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorEmployeeId: input.actorEmployeeId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValues:
          input.oldValues === undefined
            ? undefined
            : redactAuditValue(input.oldValues),
        newValues:
          input.newValues === undefined
            ? undefined
            : redactAuditValue(input.newValues),
        reason: input.reason,
        requestId: input.requestId.slice(0, 80),
      },
    });
  }
}
