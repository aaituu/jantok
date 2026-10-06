import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
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
  AdminRefundDto,
  PaymentCheckoutDto,
  RefundRequestDto,
  RegisterReceiptDto,
} from './payment.dto.js';
import { PaymentService } from './payment.service.js';
import {
  RecurringAddonDto,
  RecurringAddonRefundDto,
} from '../loyalty/loyalty.dto.js';

@Controller('payments')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post('checkout')
  checkout(@CurrentAuth() auth: AuthContext, @Body() dto: PaymentCheckoutDto) {
    return this.payments.checkout(auth.userId, dto);
  }

  @Get('history')
  history(@CurrentAuth() auth: AuthContext) {
    return this.payments.paymentHistory(auth.userId);
  }

  @Get('methods')
  methods(@CurrentAuth() auth: AuthContext) {
    return this.payments.paymentMethods(auth.userId);
  }

  @Post('refunds')
  refund(@CurrentAuth() auth: AuthContext, @Body() dto: RefundRequestDto) {
    if (
      dto.simulationNow &&
      !['local', 'test'].includes(process.env.APP_ENV ?? '')
    )
      throw new NotFoundException();
    return this.payments.requestRefund(
      auth.userId,
      dto,
      dto.simulationNow ? new Date(dto.simulationNow) : undefined,
    );
  }

  @Post('addons/recurring')
  recurringAddon(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: RecurringAddonDto,
  ) {
    return this.payments.checkoutRecurringAddon(auth.userId, dto);
  }

  @Post('addons/refunds')
  recurringAddonRefund(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: RecurringAddonRefundDto,
  ) {
    return this.payments.refundRecurringAddon(auth.userId, dto);
  }

  @Post('return/:purchaseId')
  async checkoutReturn(
    @CurrentAuth() auth: AuthContext,
    @Param('purchaseId') purchaseId: string,
  ) {
    const history = await this.payments.paymentHistory(auth.userId);
    const purchase = history.find((item) => item.id === purchaseId);
    if (!purchase) return { found: false };
    return {
      found: true,
      purchaseId,
      status: purchase.status,
      message:
        'The return link reports current server state and never confirms payment.',
    };
  }

  @Public()
  @Post('webhooks/local-simulator')
  webhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-simulator-signature') signature = '',
  ) {
    if (
      !['local', 'test'].includes(process.env.APP_ENV ?? 'local') ||
      (process.env.PAYMENT_PROVIDER_MODE ?? 'local') !== 'local'
    )
      throw new NotFoundException({
        code: 'ROUTE_NOT_AVAILABLE',
        message: 'Local payment simulator is unavailable',
      });
    return this.payments.handleWebhook(JSON.stringify(body), signature);
  }
}

@Controller('staff/payments')
@UseGuards(PermissionsGuard)
export class StaffPaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post('refunds')
  @RequirePermission('refund.manage')
  refund(@CurrentAuth() auth: AuthContext, @Body() dto: AdminRefundDto) {
    return this.payments.adminRefund(auth.userId, dto);
  }

  @Post('receipts/register')
  @RequirePermission('fiscalization.manage')
  receipt(@CurrentAuth() auth: AuthContext, @Body() dto: RegisterReceiptDto) {
    return this.payments.registerReceipt(auth.userId, dto);
  }
}
