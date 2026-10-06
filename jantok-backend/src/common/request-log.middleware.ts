import type { NextFunction, Request, Response } from 'express';

export function requestLogMiddleware(
  request: Request & { requestId?: string },
  response: Response,
  next: NextFunction,
) {
  const startedAt = process.hrtime.bigint();
  response.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    process.stdout.write(
      `${JSON.stringify({
        level: response.statusCode >= 500 ? 'error' : 'info',
        event: 'http.request_completed',
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      })}\n`,
    );
  });
  next();
}
