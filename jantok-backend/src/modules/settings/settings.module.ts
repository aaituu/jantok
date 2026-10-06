import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../admin/permissions.guard.js';
import {
  RuntimeConfigController,
  StaffSettingsController,
} from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
  controllers: [RuntimeConfigController, StaffSettingsController],
  providers: [SettingsService, PermissionsGuard],
  exports: [SettingsService],
})
export class SettingsModule {}
