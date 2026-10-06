import { Global, Module } from '@nestjs/common';
import { PermissionsGuard } from '../admin/permissions.guard.js';
import { DatabaseModule } from '../../database/database.module.js';
import { FISCALIZATION_PROVIDER } from './fiscalization-provider.js';
import {
  LocalFiscalizationProvider,
  LocalPaymentProvider,
  UnconfiguredFiscalizationProvider,
  UnconfiguredPaymentProvider,
} from './local-providers.js';
import {
  PaymentController,
  StaffPaymentController,
} from './payment.controller.js';
import { PAYMENT_PROVIDER } from './payment-provider.js';
import { PaymentService } from './payment.service.js';
import { LoyaltyModule } from '../loyalty/loyalty.module.js';

@Global()
@Module({
  imports: [DatabaseModule, LoyaltyModule],
  controllers: [PaymentController, StaffPaymentController],
  providers: [
    LocalPaymentProvider,
    LocalFiscalizationProvider,
    UnconfiguredPaymentProvider,
    UnconfiguredFiscalizationProvider,
    PermissionsGuard,
    {
      provide: PAYMENT_PROVIDER,
      inject: [LocalPaymentProvider, UnconfiguredPaymentProvider],
      useFactory: (
        local: LocalPaymentProvider,
        unavailable: UnconfiguredPaymentProvider,
      ) =>
        (process.env.PAYMENT_PROVIDER_MODE ?? 'local') === 'local'
          ? local
          : unavailable,
    },
    {
      provide: FISCALIZATION_PROVIDER,
      inject: [LocalFiscalizationProvider, UnconfiguredFiscalizationProvider],
      useFactory: (
        local: LocalFiscalizationProvider,
        unavailable: UnconfiguredFiscalizationProvider,
      ) =>
        (process.env.FISCALIZATION_PROVIDER_MODE ?? 'local') === 'local'
          ? local
          : unavailable,
    },
    PaymentService,
  ],
  exports: [PaymentService, PAYMENT_PROVIDER, FISCALIZATION_PROVIDER],
})
export class PaymentModule {}
