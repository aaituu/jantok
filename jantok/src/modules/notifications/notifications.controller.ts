import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  PermissionsGuard,
  RequirePermission,
} from '../admin/permissions.guard.js';
import { NotificationsService } from './notifications.service.js';

@Controller('staff/notifications')
@UseGuards(PermissionsGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('outbox')
  @RequirePermission('notifications.manage')
  list() {
    return this.notifications.list();
  }

  @Post('dispatch')
  @RequirePermission('notifications.manage')
  dispatch(@Query('limit') limit?: string) {
    return this.notifications.dispatchDue(Number(limit ?? 100));
  }
}
