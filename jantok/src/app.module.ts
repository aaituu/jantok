import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard.js';
import { HouseholdModule } from './modules/households/household.module.js';
import { NutritionModule } from './modules/nutrition/nutrition.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { CutoffModule } from './modules/cutoff/cutoff.module.js';
import { SubscriptionModule } from './modules/subscriptions/subscription.module.js';
import { MenuModule } from './modules/menu/menu.module.js';
import { PaymentModule } from './modules/payments/payment.module.js';
import { LoyaltyModule } from './modules/loyalty/loyalty.module.js';
import { DeliveryModule } from './modules/delivery/delivery.module.js';
import { KitchenModule } from './modules/kitchen/kitchen.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { SupportModule } from './modules/support/support.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
    AuditModule,
    RedisModule,
    HealthModule,
    AuthModule,
    HouseholdModule,
    NutritionModule,
    AdminModule,
    CutoffModule,
    LoyaltyModule,
    DeliveryModule,
    KitchenModule,
    PaymentModule,
    SubscriptionModule,
    MenuModule,
    SupportModule,
    SettingsModule,
    AnalyticsModule,
    NotificationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
