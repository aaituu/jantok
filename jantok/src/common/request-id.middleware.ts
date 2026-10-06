import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestIdMiddleware(
  request: Request & { requestId?: string },
  response: Response,
  next: NextFunction,
) {
  const candidate = request.header('x-request-id')?.slice(0, 80);
  request.requestId =
    candidate && /^[A-Za-z0-9._-]+$/.test(candidate) ? candidate : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
