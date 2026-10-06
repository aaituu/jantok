import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host
      .switchToHttp()
      .getRequest<Request & { requestId?: string }>();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw =
      error instanceof HttpException ? error.getResponse() : undefined;
    const object =
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, unknown>)
        : {};
    if (status === HttpStatus.INTERNAL_SERVER_ERROR)
      process.stderr.write(
        `${JSON.stringify({
          level: 'error',
          event: 'api.unhandled_error',
          requestId: request.requestId,
          method: request.method,
          path: request.path,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { name: 'UnknownError' },
        })}\n`,
      );
    response.status(status).json({
      error: {
        code: String(
          object.code ?? (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
        ),
        message:
          object.message ??
          (status === 500
            ? 'Unexpected internal error'
            : error instanceof Error
              ? error.message
              : 'Request failed'),
        details: object.details,
        requestId: request.requestId,
      },
    });
  }
}
