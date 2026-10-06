import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../../common/auth-context.js';
import {
  PermissionsGuard,
  RequirePermission,
} from '../admin/permissions.guard.js';
import { AnalyticsQueryDto, CreateExportDto } from './analytics.dto.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('staff/analytics')
@UseGuards(PermissionsGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @RequirePermission('analytics.view')
  summary(@Query() query: AnalyticsQueryDto) {
    return this.analytics.summary(query);
  }

  @Post('exports')
  @RequirePermission('exports.create')
  createExport(@CurrentAuth() auth: AuthContext, @Body() dto: CreateExportDto) {
    return this.analytics.createExport(
      auth.employeeId!,
      auth.permissions ?? [],
      dto,
    );
  }

  @Get('exports')
  @RequirePermission('exports.create')
  exports(@CurrentAuth() auth: AuthContext) {
    return this.analytics.listExports(auth.employeeId!);
  }

  @Get('exports/:id/download')
  @RequirePermission('exports.create')
  async download(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const file = await this.analytics.download(auth.employeeId!, id);
    response.setHeader('content-type', file.mimeType);
    response.setHeader(
      'content-disposition',
      `attachment; filename="${file.fileName.replaceAll('"', '')}"`,
    );
    response.send(file.data);
  }
}
