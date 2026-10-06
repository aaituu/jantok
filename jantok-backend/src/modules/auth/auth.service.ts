import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  createCipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { SignJWT } from 'jose';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { PrismaService } from '../../database/prisma.service.js';
import { REDIS } from '../../redis/redis.module.js';
import type { AuthContext } from '../../common/auth-context.js';
import type {
  DeviceTokenDto,
  RequestOtpDto,
  VerifyOtpDto,
} from './auth.dto.js';
import { OTP_PROVIDER, type OtpProvider } from './otp-provider.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
  ) {}

  private number(name: string, fallback: number) {
    return Number(process.env[name] ?? fallback);
  }
  private hash(value: string, secret = process.env.OTP_HASH_SECRET!) {
    return createHmac('sha256', secret).update(value).digest('hex');
  }
  private normalize(raw: string) {
    const parsed = parsePhoneNumberFromString(raw, 'KZ');
    if (!parsed?.isValid())
      throw new BadRequestException({
        code: 'INVALID_PHONE',
        message: 'Phone must be a valid number',
      });
    return parsed.number;
  }
  private async rateLimit(scope: string, value: string, limit: number) {
    const window = this.number('OTP_RATE_LIMIT_WINDOW_SECONDS', 3600);
    const key = `otp:rate:${scope}:${this.hash(value).slice(0, 32)}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, window);
    if (count > limit)
      throw new HttpException(
        {
          code: 'OTP_RATE_LIMITED',
          message: 'Too many OTP requests',
          details: { retryAfterSeconds: await this.redis.ttl(key) },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  async requestOtp(dto: RequestOtpDto, ip: string) {
    const phone = this.normalize(dto.phone);
    if ((process.env.OTP_PROVIDER_MODE ?? 'local') === 'local') {
      const allowed = (process.env.OTP_LOCAL_ALLOWED_PHONES ?? '')
        .split(',')
        .map((x) => x.trim());
      if (!allowed.includes(phone))
        throw new BadRequestException({
          code: 'LOCAL_PHONE_NOT_ALLOWED',
          message: 'Phone is not allowed by local OTP provider',
        });
    }
    await this.rateLimit(
      'phone',
      phone,
      this.number('OTP_RATE_LIMIT_PER_PHONE', 5),
    );
    await this.rateLimit('ip', ip, this.number('OTP_RATE_LIMIT_PER_IP', 20));
    await this.rateLimit(
      'device',
      dto.deviceId,
      this.number('OTP_RATE_LIMIT_PER_DEVICE', 10),
    );
    const latest = await this.prisma.otpChallenge.findFirst({
      where: {
        phone,
        deviceId: dto.deviceId,
        consumedAt: null,
        invalidatedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && latest.resendAfter > new Date())
      throw new HttpException(
        {
          code: 'OTP_RESEND_DELAY',
          message: 'Wait before requesting another code',
          details: {
            retryAfterSeconds: Math.ceil(
              (latest.resendAfter.getTime() - Date.now()) / 1000,
            ),
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const length = this.number('OTP_CODE_LENGTH', 6);
    const code = String(
      Number.parseInt(randomBytes(4).toString('hex'), 16) % 10 ** length,
    ).padStart(length, '0');
    const ttl = this.number('OTP_TTL_SECONDS', 300);
    const resend = this.number('OTP_RESEND_SECONDS', 60);
    const challenge = await this.prisma.$transaction(async (tx) => {
      await tx.otpChallenge.updateMany({
        where: {
          phone,
          deviceId: dto.deviceId,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: new Date() },
      });
      return tx.otpChallenge.create({
        data: {
          phone,
          deviceId: dto.deviceId,
          requestIp: ip,
          codeHash: this.hash(`${phone}:${code}`),
          maxAttempts: this.number('OTP_MAX_ATTEMPTS', 5),
          expiresAt: new Date(Date.now() + ttl * 1000),
          resendAfter: new Date(Date.now() + resend * 1000),
        },
      });
    });
    await this.otpProvider.send(phone, challenge.id, code, ttl);
    return {
      challengeId: challenge.id,
      expiresInSeconds: ttl,
      resendAfterSeconds: resend,
    };
  }

  async devInbox(phoneRaw: string, token: string | undefined) {
    if (
      !['local', 'test'].includes(process.env.APP_ENV ?? 'local') ||
      (process.env.OTP_PROVIDER_MODE ?? 'local') !== 'local'
    )
      throw new NotFoundException({
        code: 'ROUTE_NOT_AVAILABLE',
        message: 'Development inbox is unavailable',
      });
    if (!token || token !== process.env.OTP_DEV_INBOX_TOKEN)
      throw new UnauthorizedException({
        code: 'DEV_INBOX_FORBIDDEN',
        message: 'Development inbox is unavailable',
      });
    const value = await this.otpProvider.readDevelopmentInbox(
      this.normalize(phoneRaw),
    );
    if (!value)
      throw new BadRequestException({
        code: 'OTP_NOT_FOUND',
        message: 'No active local OTP',
      });
    return value;
  }

  async verify(dto: VerifyOtpDto, ip: string, userAgent?: string) {
    const phone = this.normalize(dto.phone);
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: {
        phone,
        deviceId: dto.deviceId,
        consumedAt: null,
        invalidatedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (
      !challenge ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= challenge.maxAttempts
    )
      throw new UnauthorizedException({
        code: 'OTP_INVALID_OR_EXPIRED',
        message: 'OTP is invalid or expired',
      });
    const expected = Buffer.from(challenge.codeHash, 'hex');
    const actual = Buffer.from(this.hash(`${phone}:${dto.code}`), 'hex');
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException({
        code: 'OTP_INVALID_OR_EXPIRED',
        message: 'OTP is invalid or expired',
      });
    }
    let user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user && (!dto.firstName?.trim() || !dto.lastName?.trim()))
      throw new BadRequestException({
        code: 'NAMES_REQUIRED',
        message: 'First and last name are required for registration',
      });
    const referralCode = dto.referralCode?.trim().toUpperCase();
    const referrer =
      !user && referralCode
        ? await this.prisma.user.findUnique({ where: { referralCode } })
        : null;
    if (!user && referralCode && !referrer)
      throw new BadRequestException({
        code: 'REFERRAL_CODE_INVALID',
        message: 'Referral code is invalid',
      });
    const result = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, invalidatedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new ConflictException({
          code: 'OTP_ALREADY_USED',
          message: 'OTP was already used',
        });
      user =
        user ??
        (await tx.user.create({
          data: {
            phone,
            firstName: dto.firstName!.trim(),
            lastName: dto.lastName!.trim(),
            referralCode: `J${randomBytes(5).toString('hex').toUpperCase()}`,
            household: { create: {} },
          },
        }));
      if (!user.referralCode)
        user = await tx.user.update({
          where: { id: user.id },
          data: {
            referralCode: `J${randomBytes(5).toString('hex').toUpperCase()}`,
          },
        });
      if (referrer)
        await tx.referral.create({
          data: {
            referrerUserId: referrer.id,
            inviteeUserId: user.id,
            referralCodeSnapshot: referralCode!,
          },
        });
      await tx.employee.updateMany({
        where: { phone, userId: null },
        data: { userId: user.id, status: 'ACTIVE' },
      });
      await tx.userSession.updateMany({
        where: { userId: user.id, deviceId: dto.deviceId, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'DEVICE_RELOGIN' },
      });
      const refresh = this.newRefresh();
      const session = await tx.userSession.create({
        data: {
          userId: user.id,
          deviceId: dto.deviceId,
          deviceName: dto.deviceName,
          refreshTokenHash: this.hash(refresh, process.env.JWT_REFRESH_SECRET),
          userAgent,
          ipAddress: ip,
          expiresAt: new Date(
            Date.now() + this.number('JWT_REFRESH_TTL_SECONDS', 2592000) * 1000,
          ),
        },
      });
      return { user, session, refresh };
    });
    return this.tokens(result.user, result.session.id, result.refresh);
  }

  private newRefresh() {
    return randomBytes(48).toString('base64url');
  }
  private async access(userId: string, sessionId: string) {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${this.number('JWT_ACCESS_TTL_SECONDS', 900)}s`)
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));
  }
  private async tokens(
    user: { id: string; phone: string; firstName: string; lastName: string },
    sessionId: string,
    refreshToken: string,
  ) {
    return {
      accessToken: await this.access(user.id, sessionId),
      refreshToken,
      expiresInSeconds: this.number('JWT_ACCESS_TTL_SECONDS', 900),
      user,
    };
  }
  async refresh(raw: string) {
    const hash = this.hash(raw, process.env.JWT_REFRESH_SECRET);
    const used = await this.prisma.usedRefreshToken.findUnique({
      where: { tokenHash: hash },
    });
    if (used) {
      await this.prisma.$transaction([
        this.prisma.userSession.update({
          where: { id: used.sessionId },
          data: { revokedAt: new Date(), revocationReason: 'REFRESH_REUSE' },
        }),
        this.prisma.deviceToken.updateMany({
          where: { sessionId: used.sessionId },
          data: { revokedAt: new Date() },
        }),
      ]);
      throw new UnauthorizedException({
        code: 'REFRESH_REUSE_DETECTED',
        message: 'Session revoked because a refresh token was reused',
      });
    }
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    const next = this.newRefresh();
    await this.prisma.$transaction([
      this.prisma.usedRefreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: hash,
          expiresAt: session.expiresAt,
        },
      }),
      this.prisma.userSession.update({
        where: { id: session.id },
        data: {
          refreshTokenHash: this.hash(next, process.env.JWT_REFRESH_SECRET),
          refreshVersion: { increment: 1 },
          lastUsedAt: new Date(),
        },
      }),
    ]);
    return this.tokens(session.user, session.id, next);
  }
  async sessions(auth: AuthContext) {
    return this.prisma.userSession.findMany({
      where: { userId: auth.userId },
      select: {
        id: true,
        deviceId: true,
        deviceName: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async revoke(auth: AuthContext, sessionId = auth.sessionId) {
    const changed = await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId: auth.userId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revocationReason:
          sessionId === auth.sessionId ? 'LOGOUT' : 'USER_REVOKED',
      },
    });
    if (!changed.count)
      throw new BadRequestException({
        code: 'SESSION_NOT_ACTIVE',
        message: 'Session is not active',
      });
    await this.prisma.deviceToken.updateMany({
      where: { sessionId },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }
  async registerDevice(auth: AuthContext, dto: DeviceTokenDto) {
    const session = await this.prisma.userSession.findFirst({
      where: {
        id: auth.sessionId,
        userId: auth.userId,
        deviceId: dto.deviceId,
        revokedAt: null,
      },
    });
    if (!session)
      throw new BadRequestException({
        code: 'DEVICE_SESSION_MISMATCH',
        message: 'Device must match current session',
      });
    const key = Buffer.from(process.env.PII_ENCRYPTION_KEY!, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(dto.token, 'utf8'),
      cipher.final(),
    ]);
    const packed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      'base64',
    );
    return this.prisma.deviceToken.upsert({
      where: {
        sessionId_deviceId: {
          sessionId: auth.sessionId,
          deviceId: dto.deviceId,
        },
      },
      create: {
        userId: auth.userId,
        sessionId: auth.sessionId,
        deviceId: dto.deviceId,
        tokenHash: this.hash(dto.token, process.env.SESSION_SECRET),
        encryptedToken: packed,
        platform: dto.platform,
        locale: dto.locale ?? 'kk',
      },
      update: {
        tokenHash: this.hash(dto.token, process.env.SESSION_SECRET),
        encryptedToken: packed,
        platform: dto.platform,
        locale: dto.locale ?? 'kk',
        revokedAt: null,
        lastSeenAt: new Date(),
      },
      select: { id: true, platform: true, deviceId: true, locale: true },
    });
  }
}
