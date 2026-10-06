import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../admin/permissions.guard.js';
import { LocalPushProvider } from './local-push-provider.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { PushProvider } from './push-provider.js';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PermissionsGuard,
    LocalPushProvider,
    { provide: PushProvider, useExisting: LocalPushProvider },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
