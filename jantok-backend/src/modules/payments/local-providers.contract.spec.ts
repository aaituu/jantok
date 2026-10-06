import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LocalFiscalizationProvider,
  LocalPaymentProvider,
} from './local-providers.js';

describe('PaymentProvider contract: local simulator', () => {
  it('uses the idempotency key for one stable capture operation', async () => {
    const provider = new LocalPaymentProvider();
    const request = {
      idempotencyKey: 'payment:contract-123',
      purchaseId: '5b851e06-a79b-4f30-884f-f380493b0790',
      amountKzt: 12_345,
      saveMethod: true,
    };
    const first = await provider.createPayment(request);
    const repeated = await provider.createPayment(request);
    expect(repeated.operationId).toBe(first.operationId);
    expect(repeated.status).toBe('CAPTURED');
    expect(repeated.paymentMethod?.last4).toBe('4242');
    expect(JSON.stringify(repeated)).not.toMatch(/pan|cvv/i);
  });

  it('uses one stable provider refund ID for safe retries', async () => {
    const provider = new LocalPaymentProvider();
    const input = {
      idempotencyKey: 'refund:contract-123',
      operationId: 'sim_pay_123',
      amountKzt: 1_000,
      reason: 'contract test',
    };
    const first = await provider.refund(input);
    const repeated = await provider.refund(input);
    expect(repeated.refundId).toBe(first.refundId);
    expect(repeated.status).toBe('SUCCEEDED');
  });

  it('authenticates webhooks before parsing their authoritative status', () => {
    process.env.PAYMENT_SIMULATOR_WEBHOOK_SECRET =
      'local-webhook-secret-change-before-sharing-32';
    const raw = JSON.stringify({
      eventId: 'evt-1',
      eventType: 'payment.updated',
      operationId: 'sim_pay_1',
      occurredAt: '2026-09-24T10:00:00.000Z',
      status: 'CAPTURED',
      amountKzt: 10_000,
      pan: 'must-not-be-persisted',
      cvv: 'must-not-be-persisted',
    });
    const signature = createHmac(
      'sha256',
      process.env.PAYMENT_SIMULATOR_WEBHOOK_SECRET,
    )
      .update(raw)
      .digest('hex');
    const verified = new LocalPaymentProvider().verifyWebhook(raw, signature);
    expect(verified).toMatchObject({
      eventId: 'evt-1',
      operationId: 'sim_pay_1',
    });
    expect(JSON.stringify(verified.safePayload)).not.toMatch(/pan|cvv/i);
    expect(() =>
      new LocalPaymentProvider().verifyWebhook(raw, '0'.repeat(64)),
    ).toThrow('Webhook signature is invalid');
  });
});

describe('FiscalizationProvider contract: local simulator', () => {
  it('clearly emits a non-fiscal test receipt', async () => {
    const result = await new LocalFiscalizationProvider().issueSale({
      idempotencyKey: 'receipt-123',
      purchaseId: 'purchase-123',
      amountKzt: 5_000,
    });
    expect(result.fiscal).toBe(false);
    expect(result.safeSnapshot.label).toBe(
      'TEST RECEIPT — NOT A FISCAL RECEIPT',
    );
  });
});
