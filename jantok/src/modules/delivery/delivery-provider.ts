export type DeliveryPoint = {
  coordinates: [longitude: number, latitude: number];
  address: string;
  entrance?: string;
  floor?: string;
  apartment?: string;
  intercom?: string;
  instructions?: string;
};

export type DeliveryQuote = {
  currency: 'KZT';
  priceKzt: number;
  expiresAt: string;
  providerSnapshot: Record<string, unknown>;
};

export type DeliveryCreateRequest = {
  idempotencyKey: string;
  due: string;
  pickup: DeliveryPoint;
  destination: DeliveryPoint;
  comment: string;
};

export type ProviderDeliveryStatus = {
  providerReference: string;
  status: string;
  updatedAt: string;
  terminal: boolean;
  raw?: Record<string, unknown>;
};

export type CourierInfo = {
  name?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  updatedAt: string;
};

export type TrackingInfo = {
  url?: string;
  latitude?: number;
  longitude?: number;
  updatedAt: string;
};

export type EtaInfo = { eta?: string; updatedAt: string };

/**
 * Provider boundary. A future Yandex adapter must map these operations only to
 * methods enabled by JANTOK's Kazakhstan contract. It must reuse
 * idempotencyKey as Yandex request_id after a timeout.
 */
export interface DeliveryProvider {
  readonly name: string;
  calculateDelivery(request: DeliveryCreateRequest): Promise<DeliveryQuote>;
  createDelivery(
    request: DeliveryCreateRequest,
  ): Promise<ProviderDeliveryStatus>;
  cancelDelivery(
    providerReference: string,
    idempotencyKey: string,
  ): Promise<ProviderDeliveryStatus>;
  getStatus(providerReference: string): Promise<ProviderDeliveryStatus>;
  getCourier(providerReference: string): Promise<CourierInfo | null>;
  getTracking(providerReference: string): Promise<TrackingInfo | null>;
  getETA(providerReference: string): Promise<EtaInfo | null>;
}

export const DELIVERY_PROVIDER = Symbol('DELIVERY_PROVIDER');
