export type ProviderPaymentStatus =
  | 'PENDING'
  | 'REQUIRES_ACTION'
  | 'CAPTURED'
  | 'FAILED'
  | 'CANCELLED'
  | 'UNKNOWN';

export type ProviderPayment = {
  operationId: string;
  status: ProviderPaymentStatus;
  amountKzt: number;
  checkoutUrl?: string;
  occurredAt: Date;
  paymentMethod?: {
    tokenRef: string;
    mandateRef?: string;
    brand?: string;
    last4?: string;
    expiryMonth?: number;
    expiryYear?: number;
  };
  safeSnapshot: Record<string, unknown>;
};

export type ProviderRefund = {
  refundId: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  occurredAt: Date;
  safeSnapshot: Record<string, unknown>;
};

export type VerifiedProviderEvent = {
  eventId: string;
  eventType: string;
  operationId: string;
  occurredAt: Date;
  payment?: ProviderPayment;
  refund?: ProviderRefund;
  safePayload: Record<string, unknown>;
};

export interface PaymentProvider {
  readonly code: string;
  createPayment(input: {
    idempotencyKey: string;
    purchaseId: string;
    amountKzt: number;
    returnUrl?: string;
    saveMethod: boolean;
    paymentMethodTokenRef?: string;
  }): Promise<ProviderPayment>;
  getPayment(operationId: string): Promise<ProviderPayment>;
  refund(input: {
    idempotencyKey: string;
    operationId: string;
    amountKzt: number;
    reason: string;
  }): Promise<ProviderRefund>;
  verifyWebhook(rawBody: string, signature: string): VerifiedProviderEvent;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
