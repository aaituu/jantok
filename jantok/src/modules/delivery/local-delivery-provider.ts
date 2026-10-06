import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  CourierInfo,
  DeliveryCreateRequest,
  DeliveryProvider,
  DeliveryQuote,
  EtaInfo,
  ProviderDeliveryStatus,
  TrackingInfo,
} from './delivery-provider.js';

@Injectable()
export class LocalDeliveryProvider implements DeliveryProvider {
  readonly name = 'LOCAL_SIMULATOR';
  private readonly operations = new Map<string, ProviderDeliveryStatus>();

  private reference(key: string) {
    return `local_delivery_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
  }

  async calculateDelivery(
    request: DeliveryCreateRequest,
  ): Promise<DeliveryQuote> {
    return {
      currency: 'KZT',
      priceKzt: 0,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      providerSnapshot: {
        simulator: true,
        note: 'TEST DELIVERY QUOTE — delivery is included in subscription',
        requestId: request.idempotencyKey,
      },
    };
  }

  async createDelivery(
    request: DeliveryCreateRequest,
  ): Promise<ProviderDeliveryStatus> {
    const providerReference = this.reference(request.idempotencyKey);
    const existing = this.operations.get(providerReference);
    if (existing) return existing;
    const created: ProviderDeliveryStatus = {
      providerReference,
      status: 'accepted',
      updatedAt: new Date().toISOString(),
      terminal: false,
      raw: {
        simulator: true,
        due: request.due,
        requestId: request.idempotencyKey,
      },
    };
    this.operations.set(providerReference, created);
    return created;
  }

  async cancelDelivery(providerReference: string) {
    const current = await this.getStatus(providerReference);
    const cancelled = {
      ...current,
      status: 'cancelled',
      terminal: true,
      updatedAt: new Date().toISOString(),
    };
    this.operations.set(providerReference, cancelled);
    return cancelled;
  }

  async getStatus(providerReference: string) {
    return (
      this.operations.get(providerReference) ?? {
        providerReference,
        status: 'unknown',
        terminal: false,
        updatedAt: new Date().toISOString(),
        raw: { simulator: true, restoredAfterRestart: true },
      }
    );
  }

  async getCourier(_providerReference: string): Promise<CourierInfo | null> {
    return null;
  }

  async getTracking(_providerReference: string): Promise<TrackingInfo | null> {
    return null;
  }

  async getETA(_providerReference: string): Promise<EtaInfo | null> {
    return null;
  }
}

@Injectable()
export class UnconfiguredDeliveryProvider implements DeliveryProvider {
  readonly name = 'UNCONFIGURED';
  private unavailable(): never {
    throw new Error('DELIVERY_PROVIDER_NOT_CONFIGURED');
  }
  async calculateDelivery(): Promise<DeliveryQuote> {
    return this.unavailable();
  }
  async createDelivery(): Promise<ProviderDeliveryStatus> {
    return this.unavailable();
  }
  async cancelDelivery(): Promise<ProviderDeliveryStatus> {
    return this.unavailable();
  }
  async getStatus(): Promise<ProviderDeliveryStatus> {
    return this.unavailable();
  }
  async getCourier(): Promise<CourierInfo | null> {
    return this.unavailable();
  }
  async getTracking(): Promise<TrackingInfo | null> {
    return this.unavailable();
  }
  async getETA(): Promise<EtaInfo | null> {
    return this.unavailable();
  }
}
