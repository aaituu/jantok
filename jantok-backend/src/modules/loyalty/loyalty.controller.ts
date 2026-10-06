import { Controller, Get } from '@nestjs/common';
import { CurrentAuth, type AuthContext } from '../../common/auth-context.js';
import { LoyaltyService } from './loyalty.service.js';

@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('club')
  club(@CurrentAuth() auth: AuthContext) {
    return this.loyalty.clubDashboard(auth.userId);
  }

  @Get('addons')
  addons(@CurrentAuth() auth: AuthContext) {
    return this.loyalty.addonCatalog(auth.userId);
  }
}
