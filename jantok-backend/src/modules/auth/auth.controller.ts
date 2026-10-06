import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CurrentAuth,
  Public,
  type AuthContext,
} from '../../common/auth-context.js';
import { AuthService } from './auth.service.js';
import {
  DeviceTokenDto,
  RefreshDto,
  RequestOtpDto,
  VerifyOtpDto,
} from './auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('otp/request') request(
    @Body() dto: RequestOtpDto,
    @Ip() ip: string,
  ) {
    return this.auth.requestOtp(dto, ip);
  }
  @Public() @Post('otp/resend') resend(
    @Body() dto: RequestOtpDto,
    @Ip() ip: string,
  ) {
    return this.auth.requestOtp(dto, ip);
  }
  @Public() @Post('otp/verify') verify(
    @Body() dto: VerifyOtpDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.auth.verify(dto, ip, req.headers['user-agent']);
  }
  @Public() @Get('otp/dev-inbox/:phone') inbox(
    @Param('phone') phone: string,
    @Headers('x-dev-inbox-token') token?: string,
  ) {
    return this.auth.devInbox(phone, token);
  }
  @Public() @Post('refresh') refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }
  @Get('sessions') sessions(@CurrentAuth() auth: AuthContext) {
    return this.auth.sessions(auth);
  }
  @Delete('sessions/current') logout(@CurrentAuth() auth: AuthContext) {
    return this.auth.revoke(auth);
  }
  @Delete('sessions/:id') revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ) {
    return this.auth.revoke(auth, id);
  }
  @Post('device-tokens') device(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: DeviceTokenDto,
  ) {
    return this.auth.registerDevice(auth, dto);
  }
}
