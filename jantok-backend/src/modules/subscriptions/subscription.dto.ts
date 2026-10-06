import {
  ArrayMinSize,
  ArrayUnique,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsObject,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsPositive,
} from 'class-validator';

export class CreateQuoteDto {
  @IsUUID() addressId!: string;
  @IsDateString() startDate!: string;
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  memberIds!: string[];
  @IsOptional() @IsInt() @Min(0) bonusKzt = 0;
  @IsOptional() @IsInt() @Min(0) @Max(30) guestDays = 0;
  @IsOptional() @IsString() @MaxLength(64) promoCode?: string;
}

export class CheckoutDto {
  @IsUUID() quoteId!: string;
  @IsString() @MinLength(8) idempotencyKey!: string;
  @IsOptional() @IsBoolean() autoRenew = false;
}

export class SkipDayDto {
  @IsDateString() serviceDate!: string;
  @IsString() @MinLength(8) idempotencyKey!: string;
}

export class PauseDto {
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsString() @MinLength(8) idempotencyKey!: string;
}

export class MemberChangeQuoteDto {
  @IsUUID() memberId!: string;
  @IsOptional() @IsInt() @Min(0) bonusKzt = 0;
}

export class GuestChangeQuoteDto {
  @IsString() @MinLength(1) displayName!: string;
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsDateString({}, { each: true })
  serviceDates!: string[];
  @IsObject() nutritionSnapshot!: Record<string, unknown>;
  @IsObject() allergySnapshot!: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) bonusKzt = 0;
}

export class ChangeCheckoutDto {
  @IsUUID() quoteId!: string;
  @IsString() @MinLength(8) idempotencyKey!: string;
}

export class AutoRenewDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsUUID() paymentMethodId?: string;
  @IsOptional() @IsBoolean() termsAccepted = false;
}

export class StandaloneAddonQuoteDto {
  @IsUUID() memberId!: string;
  @IsUUID() addonId!: string;
  @IsDateString() serviceDate!: string;
  @IsInt() @IsPositive() quantity!: number;
  @IsOptional() @IsInt() @Min(0) bonusKzt = 0;
}
