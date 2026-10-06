import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { PermissionsGuard } from '../admin/permissions.guard.js';
import {
  DeliveryController,
  StaffDeliveryController,
} from './delivery.controller.js';
import { DELIVERY_PROVIDER } from './delivery-provider.js';
import {
  LocalDeliveryProvider,
  UnconfiguredDeliveryProvider,
} from './local-delivery-provider.js';
import { DeliveryService } from './delivery.service.js';
import { DeliveryZoneService } from './delivery-zone.service.js';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [DeliveryController, StaffDeliveryController],
  providers: [
    LocalDeliveryProvider,
    UnconfiguredDeliveryProvider,
    PermissionsGuard,
    DeliveryZoneService,
    DeliveryService,
    {
      provide: DELIVERY_PROVIDER,
      inject: [LocalDeliveryProvider, UnconfiguredDeliveryProvider],
      useFactory: (
        local: LocalDeliveryProvider,
        unavailable: UnconfiguredDeliveryProvider,
      ) =>
        (process.env.DELIVERY_PROVIDER_MODE ?? 'local') === 'local'
          ? local
          : unavailable,
    },
  ],
  exports: [DeliveryService, DeliveryZoneService, DELIVERY_PROVIDER],
})
export class DeliveryModule {}
