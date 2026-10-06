import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentAuth, type AuthContext } from '../../common/auth-context.js';
import {
  CheckoutDto,
  ChangeCheckoutDto,
  CreateQuoteDto,
  AutoRenewDto,
  GuestChangeQuoteDto,
  MemberChangeQuoteDto,
  StandaloneAddonQuoteDto,
  PauseDto,
  SkipDayDto,
} from './subscription.dto.js';
import { SubscriptionService } from './subscription.service.js';
import { PaymentService } from '../payments/payment.service.js';

@Controller('subscriptions')
export class SubscriptionController {
  constructor(
    private readonly service: SubscriptionService,
    private readonly payments: PaymentService,
  ) {}

  @Post('quotes')
  quote(@CurrentAuth() auth: AuthContext, @Body() dto: CreateQuoteDto) {
    return this.service.quote(auth.userId, dto);
  }

  @Post('checkout')
  checkout(@CurrentAuth() auth: AuthContext, @Body() dto: CheckoutDto) {
    return this.payments.checkout(auth.userId, dto);
  }

  @Get('current')
  async current(@CurrentAuth() auth: AuthContext) {
    return (await this.service.current(auth.userId)) ?? {};
  }

  @Post(':id/skip')
  skip(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: SkipDayDto,
  ) {
    return this.service.skip(auth.userId, id, dto);
  }

  @Post(':id/pauses')
  pause(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: PauseDto,
  ) {
    return this.service.pause(auth.userId, id, dto);
  }

  @Post(':id/member-quotes')
  memberQuote(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: MemberChangeQuoteDto,
  ) {
    return this.service.memberChangeQuote(auth.userId, id, dto);
  }

  @Post(':id/guest-quotes')
  guestQuote(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: GuestChangeQuoteDto,
  ) {
    return this.service.guestChangeQuote(auth.userId, id, dto);
  }

  @Post(':id/change-checkout')
  changeCheckout(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: ChangeCheckoutDto,
  ) {
    return this.service.changeCheckout(auth.userId, id, dto);
  }

  @Post(':id/auto-renew')
  autoRenew(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: AutoRenewDto,
  ) {
    return this.payments.configureAutoRenew(auth.userId, id, dto);
  }

  @Post(':id/standalone-addon-quotes')
  standaloneAddonQuote(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: StandaloneAddonQuoteDto,
  ) {
    return this.service.standaloneAddonQuote(auth.userId, id, dto);
  }
}
