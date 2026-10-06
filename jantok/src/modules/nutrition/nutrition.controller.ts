import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  CurrentAuth,
  Public,
  type AuthContext,
} from '../../common/auth-context.js';
import { NutritionService } from './nutrition.service.js';
import {
  MealReviewDto,
  RecommendationDto,
  SelectMealDto,
} from './nutrition.dto.js';
@Controller()
export class NutritionController {
  constructor(private readonly service: NutritionService) {}
  @Get('meals') meals() {
    return this.service.listMeals();
  }
  @Get('addons') addons() {
    return this.service.listAddons();
  }
  @Post('members/:id/recommendations') recommend(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: RecommendationDto,
  ) {
    return this.service.recommend(auth.userId, id, dto.serviceStartDate);
  }
  @Post('members/:id/meal-selections') select(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: SelectMealDto,
  ) {
    return this.service.select(auth.userId, id, dto);
  }
  @Post('meals/:id/reviews') review(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: MealReviewDto,
  ) {
    return this.service.review(auth.userId, id, dto);
  }
  @Public()
  @Get('meals/:id/reviews')
  reviews(@Param('id') id: string) {
    return this.service.listReviews(id);
  }
  @Get('reviews')
  myReviews(@CurrentAuth() auth: AuthContext) {
    return this.service.myReviews(auth.userId);
  }
  @Delete('reviews/:id')
  deleteReview(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.service.deleteReview(auth.userId, id);
  }
}
