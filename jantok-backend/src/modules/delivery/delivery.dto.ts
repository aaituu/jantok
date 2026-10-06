import { DailyFulfillmentStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class DailyFulfillmentTransitionDto {
  @IsEnum(DailyFulfillmentStatus) to!: DailyFulfillmentStatus;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @MinLength(8) @MaxLength(160) idempotencyKey!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class DeliveryProviderEventDto {
  @IsString() @MinLength(1) @MaxLength(200) eventId!: string;
  @IsString() @MinLength(1) @MaxLength(160) providerReference!: string;
  @IsString() @MinLength(1) @MaxLength(80) status!: string;
  @IsDateString() updatedAt!: string;
  @IsOptional() payload?: Record<string, unknown>;
}

export class GenerateDailyFulfillmentDto {
  @IsUUID() serviceDayId!: string;
}

export class RunDeliveryMaintenanceDto {
  @IsOptional() @IsDateString() now?: string;
}
