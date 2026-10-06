export type FiscalDocumentResult = {
  documentId: string;
  status: 'ISSUED' | 'FAILED';
  fiscal: boolean;
  documentUrl?: string;
  safeSnapshot: Record<string, unknown>;
};

export interface FiscalizationProvider {
  readonly code: string;
  issueSale(input: {
    idempotencyKey: string;
    purchaseId: string;
    amountKzt: number;
  }): Promise<FiscalDocumentResult>;
  issueRefund(input: {
    idempotencyKey: string;
    purchaseId: string;
    refundId: string;
    amountKzt: number;
  }): Promise<FiscalDocumentResult>;
}

export const FISCALIZATION_PROVIDER = Symbol('FISCALIZATION_PROVIDER');
