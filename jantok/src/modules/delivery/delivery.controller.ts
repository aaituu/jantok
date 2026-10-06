import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentAuth,
  Public,
  type AuthContext,
} from '../../common/auth-context.js';
import {
  PermissionsGuard,
  RequirePermission,
} from '../admin/permissions.guard.js';
import {
  DailyFulfillmentTransitionDto,
  DeliveryProviderEventDto,
  GenerateDailyFulfillmentDto,
  RunDeliveryMaintenanceDto,
} from './delivery.dto.js';
import { DeliveryService } from './delivery.service.js';

@Controller('deliveries')
export class DeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Get('config')
  config() {
    return this.deliveries.clientConfig();
  }

  @Get('daily-orders/:id/tracking')
  tracking(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.deliveries.tracking(auth.userId, id);
  }

  @Public()
  @Post('webhooks/local-simulator')
  webhook(
    @Body() dto: DeliveryProviderEventDto,
    @Headers('x-simulator-secret') secret = '',
  ) {
    if (
      !['local', 'test'].includes(process.env.APP_ENV ?? 'local') ||
      (process.env.DELIVERY_PROVIDER_MODE ?? 'local') !== 'local'
    )
      throw new NotFoundException({
        code: 'ROUTE_NOT_AVAILABLE',
        message: 'Local delivery simulator is unavailable',
      });
    if (
      !process.env.DELIVERY_SIMULATOR_WEBHOOK_SECRET ||
      secret !== process.env.DELIVERY_SIMULATOR_WEBHOOK_SECRET
    )
      throw new UnauthorizedException(
        'Invalid local delivery simulator secret',
      );
    return this.deliveries.acceptProviderEvent(dto);
  }
}

@Controller('staff/daily-orders')
@UseGuards(PermissionsGuard)
export class StaffDeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Post('generate')
  @RequirePermission('daily_order.manage')
  generate(@Body() dto: GenerateDailyFulfillmentDto) {
    return this.deliveries.ensureDailyFulfillment(dto.serviceDayId);
  }

  @Post(':id/transitions')
  @RequirePermission('daily_order.manage')
  transition(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: DailyFulfillmentTransitionDto,
  ) {
    return this.deliveries.transition(id, dto, 'STAFF', auth.userId);
  }

  @Post('maintenance/run')
  @RequirePermission('delivery.manage')
  maintenance(@Body() dto: RunDeliveryMaintenanceDto = {}) {
    if (dto.now && !['local', 'test'].includes(process.env.APP_ENV ?? 'local'))
      throw new NotFoundException({
        code: 'SIMULATED_CLOCK_NOT_AVAILABLE',
        message: 'A simulated maintenance clock is available only locally',
      });
    return this.deliveries.runMaintenance(
      dto.now ? new Date(dto.now) : new Date(),
    );
  }
}
