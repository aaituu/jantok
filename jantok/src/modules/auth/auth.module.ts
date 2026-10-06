import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import {
  LocalOtpProvider,
  OTP_PROVIDER,
  UnconfiguredOtpProvider,
} from './otp-provider.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    LocalOtpProvider,
    UnconfiguredOtpProvider,
    {
      provide: OTP_PROVIDER,
      inject: [LocalOtpProvider, UnconfiguredOtpProvider],
      useFactory: (
        local: LocalOtpProvider,
        unconfigured: UnconfiguredOtpProvider,
      ) =>
        (process.env.OTP_PROVIDER_MODE ?? 'local') === 'local'
          ? local
          : unconfigured,
    },
  ],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
