import { Module } from '@nestjs/common';
import { NutritionController } from './nutrition.controller.js';
import { NutritionService } from './nutrition.service.js';
@Module({
  controllers: [NutritionController],
  providers: [NutritionService],
  exports: [NutritionService],
})
export class NutritionModule {}
