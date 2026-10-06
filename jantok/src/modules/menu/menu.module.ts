import { Module } from '@nestjs/common';
import { NutritionModule } from '../nutrition/nutrition.module.js';
import { MenuController } from './menu.controller.js';
import { MenuService } from './menu.service.js';

@Module({
  imports: [NutritionModule],
  controllers: [MenuController],
  providers: [MenuService],
})
export class MenuModule {}
