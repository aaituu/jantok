import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  CurrentAuth,
  Public,
  RequestId,
  type AuthContext,
} from '../../common/auth-context.js';
import {
  PermissionsGuard,
  RequirePermission,
} from '../admin/permissions.guard.js';
import { CreateSystemSettingDto } from './settings.dto.js';
import { SettingsService } from './settings.service.js';

@Controller('config')
export class RuntimeConfigController {
  constructor(private readonly settings: SettingsService) {}
  @Public()
  @Get('runtime')
  runtime() {
    return this.settings.runtime();
  }
}

@Controller('staff/settings')
@UseGuards(PermissionsGuard)
export class StaffSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermission('settings.manage')
  list(@Query('group') group?: string) {
    return this.settings.list(group);
  }

  @Post()
  @RequirePermission('settings.manage')
  create(
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId: string,
    @Body() dto: CreateSystemSettingDto,
  ) {
    return this.settings.create(auth.userId, auth.employeeId!, dto, requestId);
  }
}
