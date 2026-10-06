import { NotFoundException } from '@nestjs/common';
import { AuthService } from '../modules/auth/auth.service.js';
import { DeliveryController } from '../modules/delivery/delivery.controller.js';
import { PaymentController } from '../modules/payments/payment.controller.js';

describe('production-only route safety', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.APP_ENV = 'production';
    process.env.OTP_PROVIDER_MODE = 'unconfigured';
    process.env.PAYMENT_PROVIDER_MODE = 'unconfigured';
    process.env.DELIVERY_PROVIDER_MODE = 'unconfigured';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not expose the OTP development inbox', async () => {
    const service = new AuthService(
      {} as never,
      {} as never,
      { readDevelopmentInbox: vi.fn() } as never,
    );

    await expect(
      service.devInbox('+77000000001', 'anything'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not expose the payment simulator webhook', () => {
    const controller = new PaymentController({
      handleWebhook: vi.fn(),
    } as never);

    expect(() => controller.webhook({}, 'anything')).toThrow(NotFoundException);
  });

  it('does not expose the delivery simulator webhook', () => {
    const controller = new DeliveryController({
      acceptProviderEvent: vi.fn(),
    } as never);

    expect(() => controller.webhook({} as never, 'anything')).toThrow(
      NotFoundException,
    );
  });
});
