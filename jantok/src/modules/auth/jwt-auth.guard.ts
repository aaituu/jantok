import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { jwtVerify } from 'jose';
import { IS_PUBLIC, type AuthContext } from '../../common/auth-context.js';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      auth?: AuthContext;
    }>();
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token)
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Bearer token is required',
      });
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(process.env.JWT_ACCESS_SECRET),
        { algorithms: ['HS256'] },
      );
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string')
        throw new Error('invalid claims');
      const session = await this.prisma.userSession.findFirst({
        where: {
          id: payload.sid,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: { user: { select: { status: true } } },
      });
      if (!session || session.user.status !== 'ACTIVE')
        throw new Error('inactive session or user');
      request.auth = { userId: payload.sub, sessionId: payload.sid };
      return true;
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_ACCESS_TOKEN',
        message: 'Access token is invalid or expired',
      });
    }
  }
}
