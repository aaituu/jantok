import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  PaymentProvider,
  ProviderPayment,
  ProviderRefund,
  VerifiedProviderEvent,
} from './payment-provider.js';
import type {
  FiscalDocumentResult,
  FiscalizationProvider,
} from './fiscalization-provider.js';

const stableId = (prefix: string, value: string) =>
  `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;

@Injectable()
export class LocalPaymentProvider implements PaymentProvider {
  readonly code = 'LOCAL_SIMULATOR';
  private readonly operations = new Map<string, ProviderPayment>();

  async createPayment(input: {
    idempotencyKey: string;
    purchaseId: string;
    amountKzt: number;
    saveMethod: boolean;
    paymentMethodTokenRef?: string;
  }) {
    const operationId = stableId('sim_pay', input.idempotencyKey);
    const prior = this.operations.get(operationId);
    if (prior) return prior;
    const result: ProviderPayment = {
      operationId,
      status: 'CAPTURED',
      amountKzt: input.amountKzt,
      occurredAt: new Date(),
      paymentMethod: input.saveMethod
        ? {
            tokenRef: stableId('sim_tok', input.purchaseId),
            mandateRef: stableId('sim_mandate', input.purchaseId),
            brand: 'SIMULATOR',
            last4: '4242',
            expiryMonth: 12,
            expiryYear: 2099,
          }
        : undefined,
      safeSnapshot: {
        simulator: true,
        result: 'captured',
        warning: 'No bank transaction occurred',
      },
    };
    this.operations.set(operationId, result);
    return result;
  }

  async getPayment(operationId: string) {
    return (
      this.operations.get(operationId) ?? {
        operationId,
        status: operationId.startsWith('sim_pay_')
          ? ('CAPTURED' as const)
          : ('UNKNOWN' as const),
        amountKzt: 0,
        occurredAt: new Date(),
        safeSnapshot: {
          simulator: true,
          result: operationId.startsWith('sim_pay_')
            ? 'captured_reconciled'
            : 'unknown',
        },
      }
    );
  }

  async refund(input: {
    idempotencyKey: string;
    operationId: string;
    amountKzt: number;
    reason: string;
  }): Promise<ProviderRefund> {
    return {
      refundId: stableId('sim_refund', input.idempotencyKey),
      status: 'SUCCEEDED',
      occurredAt: new Date(),
      safeSnapshot: {
        simulator: true,
        paymentOperationId: input.operationId,
        amountKzt: input.amountKzt,
        warning: 'No bank refund occurred',
      },
    };
  }

  verifyWebhook(rawBody: string, signature: string): VerifiedProviderEvent {
    const secret = process.env.PAYMENT_SIMULATOR_WEBHOOK_SECRET ?? '';
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const valid =
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!secret || !valid)
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Webhook signature is invalid',
      });
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    if (
      typeof body.eventId !== 'string' ||
      typeof body.eventType !== 'string' ||
      typeof body.operationId !== 'string' ||
      typeof body.occurredAt !== 'string'
    )
      throw new UnauthorizedException('Malformed provider event');
    return {
      eventId: body.eventId,
      eventType: body.eventType,
      operationId: body.operationId,
      occurredAt: new Date(body.occurredAt),
      safePayload: {
        eventId: body.eventId,
        eventType: body.eventType,
        operationId: body.operationId,
        occurredAt: body.occurredAt,
        status: body.status,
        amountKzt: body.amountKzt,
      },
      payment:
        body.eventType === 'payment.updated'
          ? {
              operationId: body.operationId,
              status: String(body.status) as ProviderPayment['status'],
              amountKzt: Number(body.amountKzt),
              occurredAt: new Date(body.occurredAt),
              safeSnapshot: { simulator: true, webhook: true },
            }
          : undefined,
    };
  }
}

@Injectable()
export class UnconfiguredPaymentProvider implements PaymentProvider {
  readonly code = 'UNCONFIGURED';
  private unavailable(): never {
    throw new Error('Real payment provider is not configured');
  }
  createPayment(): Promise<ProviderPayment> {
    return this.unavailable();
  }
  getPayment(): Promise<ProviderPayment> {
    return this.unavailable();
  }
  refund(): Promise<ProviderRefund> {
    return this.unavailable();
  }
  verifyWebhook(): VerifiedProviderEvent {
    return this.unavailable();
  }
}

@Injectable()
export class UnconfiguredFiscalizationProvider implements FiscalizationProvider {
  readonly code = 'UNCONFIGURED';
  private unavailable(): never {
    throw new Error('Real fiscalization provider is not configured');
  }
  issueSale(): Promise<FiscalDocumentResult> {
    return this.unavailable();
  }
  issueRefund(): Promise<FiscalDocumentResult> {
    return this.unavailable();
  }
}

@Injectable()
export class LocalFiscalizationProvider implements FiscalizationProvider {
  readonly code = 'LOCAL_RECEIPT_SIMULATOR';

  async issueSale(input: {
    idempotencyKey: string;
    purchaseId: string;
    amountKzt: number;
  }): Promise<FiscalDocumentResult> {
    return this.testDocument('sale', input.idempotencyKey, input.amountKzt);
  }

  async issueRefund(input: {
    idempotencyKey: string;
    purchaseId: string;
    refundId: string;
    amountKzt: number;
  }): Promise<FiscalDocumentResult> {
    return this.testDocument('refund', input.idempotencyKey, input.amountKzt);
  }

  private testDocument(kind: string, key: string, amountKzt: number) {
    return {
      documentId: stableId(`test_${kind}`, key),
      status: 'ISSUED' as const,
      fiscal: false,
      safeSnapshot: {
        label: 'TEST RECEIPT — NOT A FISCAL RECEIPT',
        kind,
        amountKzt,
      },
    };
  }
}
