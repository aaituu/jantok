import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../redis/redis.module.js';

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

export interface OtpProvider {
  send(
    phone: string,
    challengeId: string,
    code: string,
    ttlSeconds: number,
  ): Promise<void>;
  readDevelopmentInbox(
    phone: string,
  ): Promise<{ challengeId: string; code: string } | null>;
}

@Injectable()
export class LocalOtpProvider implements OtpProvider {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async send(
    phone: string,
    challengeId: string,
    code: string,
    ttlSeconds: number,
  ) {
    await this.redis.set(
      `otp:inbox:${phone}`,
      JSON.stringify({ challengeId, code }),
      'EX',
      ttlSeconds,
    );
  }
  async readDevelopmentInbox(phone: string) {
    const value = await this.redis.get(`otp:inbox:${phone}`);
    return value
      ? (JSON.parse(value) as { challengeId: string; code: string })
      : null;
  }
}

@Injectable()
export class UnconfiguredOtpProvider implements OtpProvider {
  async send() {
    throw new ServiceUnavailableException({
      code: 'OTP_PROVIDER_NOT_CONFIGURED',
      message: 'The SMS provider has not been configured for this environment',
    });
  }

  async readDevelopmentInbox() {
    return null;
  }
}
