import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../admin/permissions.guard.js';
import {
  StaffSupportController,
  SupportController,
} from './support.controller.js';
import { SupportGateway } from './support.gateway.js';
import { SupportService } from './support.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [NotificationsModule],
  controllers: [SupportController, StaffSupportController],
  providers: [SupportService, SupportGateway, PermissionsGuard],
  exports: [SupportService],
})
export class SupportModule {}
