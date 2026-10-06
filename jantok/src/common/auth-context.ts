import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export type AuthContext = {
  userId: string;
  sessionId: string;
  employeeId?: string;
  permissions?: string[];
};

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext =>
    context.switchToHttp().getRequest<{ auth: AuthContext }>().auth,
);

export const RequestId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<{ requestId?: string }>().requestId ??
    'request-id-missing',
);
