import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RecurringAddonDto {
  @IsUUID() subscriptionId!: string;
  @IsUUID() addonId!: string;
  @IsOptional() @IsUUID() participantId?: string;
  @Type(() => Number) @IsInt() @Min(1) quantityPerDay!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bonusKzt = 0;
  @IsOptional() @IsUrl({ require_tld: false }) returnUrl?: string;
  @IsString() @MaxLength(128) idempotencyKey!: string;
}

export class RecurringAddonRefundDto {
  @IsUUID() planId!: string;
  @Type(() => Number) @IsInt() @Min(1) units!: number;
  @IsString() @MaxLength(128) idempotencyKey!: string;
  @IsString() @MaxLength(500) reason!: string;
}
