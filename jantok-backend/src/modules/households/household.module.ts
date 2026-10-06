import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module.js';
import { HouseholdController } from './household.controller.js';
import { HouseholdService } from './household.service.js';
import { NutritionModule } from '../nutrition/nutrition.module.js';
@Module({
  imports: [DeliveryModule, NutritionModule],
  controllers: [HouseholdController],
  providers: [HouseholdService],
  exports: [HouseholdService],
})
export class HouseholdModule {}
