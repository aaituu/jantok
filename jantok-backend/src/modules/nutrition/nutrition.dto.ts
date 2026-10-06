import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MealType } from '@prisma/client';
export class RecommendationDto {
  @IsDateString() serviceStartDate!: string;
}
export class SelectMealDto {
  @IsUUID() mealId!: string;
  @IsDateString() serviceDate!: string;
  @IsEnum(MealType) mealType!: MealType;
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  removedIngredientIds!: string[];
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  addedIngredientIds!: string[];
  @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) addonIds!: string[];
}
export class MealReviewDto {
  @IsUUID() dailyOrderLineId!: string;
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @IsIn(['kk', 'ru', 'en']) locale!: string;
}
