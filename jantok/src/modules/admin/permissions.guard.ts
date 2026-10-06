import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthContext } from '../../common/auth-context.js';
export const REQUIRED_PERMISSION = 'requiredPermission';
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION, permission);
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const code = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!code) return true;
    const auth = context
      .switchToHttp()
      .getRequest<{ auth: AuthContext }>().auth;
    const employee = await this.prisma.employee.findFirst({
      where: {
        userId: auth.userId,
        status: 'ACTIVE',
        roles: {
          some: { role: { permissions: { some: { permission: { code } } } } },
        },
      },
      select: {
        id: true,
        roles: {
          select: {
            role: {
              select: {
                permissions: {
                  select: { permission: { select: { code: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!employee)
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: `Permission ${code} is required`,
      });
    auth.employeeId = employee.id;
    auth.permissions = employee.roles.flatMap((item) =>
      item.role.permissions.map((value) => value.permission.code),
    );
    return true;
  }
}
