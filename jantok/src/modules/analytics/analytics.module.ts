import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../admin/permissions.guard.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, PermissionsGuard],
})
export class AnalyticsModule {}
