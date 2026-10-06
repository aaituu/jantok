import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth-context.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness probe' })
  live() {
    return {
      status: 'ok',
      service: 'jantok-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'PostgreSQL, Redis, and object storage readiness probe',
  })
  ready() {
    return this.healthService.checkReadiness();
  }
}
