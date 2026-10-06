import { describe, expect, it } from 'vitest';
import { LocalDeliveryProvider } from './local-delivery-provider.js';

const request = {
  idempotencyKey: 'delivery:one',
  due: '2026-09-25T01:00:00.000Z',
  pickup: {
    coordinates: [71.43, 51.13] as [number, number],
    address: 'Kitchen',
  },
  destination: {
    coordinates: [71.44, 51.14] as [number, number],
    address: 'Home',
  },
  comment: 'Test order',
};

describe('local DeliveryProvider contract', () => {
  it('returns the same operation for the same idempotency key', async () => {
    const provider = new LocalDeliveryProvider();
    const first = await provider.createDelivery(request);
    const retry = await provider.createDelivery(request);
    expect(retry.providerReference).toBe(first.providerReference);
  });

  it('does not invent courier, tracking, or ETA data', async () => {
    const provider = new LocalDeliveryProvider();
    const created = await provider.createDelivery(request);
    expect(await provider.getCourier(created.providerReference)).toBeNull();
    expect(await provider.getTracking(created.providerReference)).toBeNull();
    expect(await provider.getETA(created.providerReference)).toBeNull();
  });
});
