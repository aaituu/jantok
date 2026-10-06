import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CurrentAuth,
  RequestId,
  type AuthContext,
} from '../../common/auth-context.js';
import {
  PermissionsGuard,
  RequirePermission,
} from '../admin/permissions.guard.js';
import {
  CreateSupportThreadDto,
  NotificationPreferenceDto,
  SendSupportMessageDto,
  SupportStatusDto,
} from './support.dto.js';
import { SupportGateway } from './support.gateway.js';
import { SupportService } from './support.service.js';

@Controller('support')
export class SupportController {
  constructor(
    private readonly service: SupportService,
    private readonly gateway: SupportGateway,
  ) {}

  @Post('threads')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateSupportThreadDto,
  ) {
    return this.service.createThread(auth.userId, dto);
  }

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5_000_000 } }))
  uploadAttachment(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile()
    file?: {
      buffer: Buffer;
      mimetype: string;
      size: number;
      originalname: string;
    },
  ) {
    return this.service.uploadCustomerAttachment(auth.userId, file);
  }

  @Get('threads')
  list(@CurrentAuth() auth: AuthContext) {
    return this.service.listCustomerThreads(auth.userId);
  }

  @Get('threads/:id/messages')
  messages(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query('after') after?: string,
  ) {
    return this.service.listCustomerMessages(auth.userId, id, after);
  }

  @Post('threads/:id/messages')
  async send(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: SendSupportMessageDto,
  ) {
    const message = await this.service.sendCustomer(auth.userId, id, dto);
    this.gateway.publish(id, message);
    return message;
  }

  @Post('threads/:id/read')
  read(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.service.markCustomerRead(auth.userId, id);
  }

  @Get('notification-preferences')
  preferences(@CurrentAuth() auth: AuthContext) {
    return this.service.preferences(auth.userId);
  }

  @Patch('notification-preferences')
  updatePreferences(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: NotificationPreferenceDto,
  ) {
    return this.service.updatePreferences(auth.userId, dto);
  }
}

@Controller('staff/support')
@UseGuards(PermissionsGuard)
export class StaffSupportController {
  constructor(
    private readonly service: SupportService,
    private readonly gateway: SupportGateway,
  ) {}

  @Get('threads')
  @RequirePermission('support.manage')
  list(@Query('q') query?: string, @Query('status') status?: never) {
    return this.service.listStaffThreads(query, status);
  }

  @Get('threads/:id/messages')
  @RequirePermission('support.manage')
  messages(@Param('id') id: string, @Query('after') after?: string) {
    return this.service.listStaffMessages(id, after);
  }

  @Post('threads/:id/messages')
  @RequirePermission('support.manage')
  async send(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: SendSupportMessageDto,
  ) {
    const message = await this.service.sendStaff(auth.employeeId!, id, dto);
    this.gateway.publish(id, message);
    return message;
  }

  @Patch('threads/:id/status')
  @RequirePermission('support.manage')
  status(
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id') id: string,
    @Body() dto: SupportStatusDto,
  ) {
    return this.service.changeStatus(
      auth.userId,
      auth.employeeId!,
      id,
      dto.status,
      dto.reason,
      requestId,
    );
  }
}
