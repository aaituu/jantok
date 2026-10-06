import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AdminSkipExceptionDto {
  @IsDateString() serviceDate!: string;
  @IsString() @MinLength(8) idempotencyKey!: string;
  @IsString() @MinLength(8) reason!: string;
}

export class AdminFreeDayDto {
  @IsString() @MinLength(8) idempotencyKey!: string;
  @IsString() @MinLength(8) reason!: string;
}

export class AdminLoyaltySettingsDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(['DEMO', 'DRAFT', 'ACTIVE']) status!: 'DEMO' | 'DRAFT' | 'ACTIVE';
  @IsInt() @Min(0) @Max(10000) welcomeBonusBps!: number;
  @IsInt() @Min(0) @Max(10000) maxRedemptionBps!: number;
  @IsBoolean() allowMultiplePromos!: boolean;
  @IsBoolean() partialRefundKeepsClubCycle!: boolean;
}

export class AdminPromoCodeDto {
  @IsString() @MinLength(2) @MaxLength(64) code!: string;
  @IsIn(['PERCENT_DISCOUNT', 'FIXED_DISCOUNT', 'BONUS_GRANT'])
  mechanic!: 'PERCENT_DISCOUNT' | 'FIXED_DISCOUNT' | 'BONUS_GRANT';
  @IsInt() @Min(0) value!: number;
  @IsIn(['DEMO', 'DRAFT', 'ACTIVE']) status!: 'DEMO' | 'DRAFT' | 'ACTIVE';
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsInt() @Min(1) totalUseLimit?: number;
  @IsInt() @Min(1) perHouseholdUseLimit!: number;
  @IsBoolean() firstSubscriptionOnly!: boolean;
  @IsInt() @Min(0) minSubtotalKzt!: number;
}

export class AdminReferralTierDto {
  @IsString() @MinLength(2) @MaxLength(64) code!: string;
  @IsIn(['DEMO', 'DRAFT', 'ACTIVE']) status!: 'DEMO' | 'DRAFT' | 'ACTIVE';
  @IsInt() @Min(1) minQualifiedReferrals!: number;
  @IsInt() @Min(0) @Max(10000) rewardBps!: number;
}

export class AdminClubTierDto {
  @IsString() @MinLength(2) @MaxLength(64) code!: string;
  @IsString() @MinLength(1) @MaxLength(120) nameKk!: string;
  @IsString() @MinLength(1) @MaxLength(120) nameRu!: string;
  @IsString() @MinLength(1) @MaxLength(120) nameEn!: string;
  @IsIn(['DEMO', 'DRAFT', 'ACTIVE']) status!: 'DEMO' | 'DRAFT' | 'ACTIVE';
  @IsInt() @Min(0) thresholdPaidCycles!: number;
  @IsInt() @Min(0) bonusMultiplierBps!: number;
}

export class AdminBlockCustomerDto {
  @IsBoolean() blocked!: boolean;
  @IsString() @MinLength(8) @MaxLength(500) reason!: string;
}

export class AdminEmployeeDto {
  @IsString() @MinLength(8) @MaxLength(20) phone!: string;
  @IsIn(['INVITED', 'ACTIVE', 'SUSPENDED']) status!:
    'INVITED' | 'ACTIVE' | 'SUSPENDED';
}

export class AdminEmployeeRoleDto {
  @IsString() @MinLength(2) @MaxLength(64) roleCode!: string;
  @IsString() @MinLength(4) @MaxLength(500) reason!: string;
}

export class AdminReviewModerationDto {
  @IsIn(['HIDE', 'DELETE', 'RESTORE']) action!: 'HIDE' | 'DELETE' | 'RESTORE';
  @IsString() @MinLength(4) @MaxLength(500) reason!: string;
}

export class AdminNotificationTemplateDto {
  @IsString() @MinLength(2) @MaxLength(80) eventCode!: string;
  @IsIn(['kk', 'ru', 'en']) locale!: string;
  @IsIn(['DEMO', 'DRAFT', 'APPROVED']) status!: 'DEMO' | 'DRAFT' | 'APPROVED';
  @IsString() @MinLength(1) @MaxLength(180) titleTemplate!: string;
  @IsString() @MinLength(1) @MaxLength(500) bodyTemplate!: string;
  @IsString() @MinLength(4) @MaxLength(500) reason!: string;
}

export class AdminManualSubscriptionDto {
  @IsIn(['PENDING', 'COMPLIMENTARY']) mode!: 'PENDING' | 'COMPLIMENTARY';
  @IsUUID() addressId!: string;
  @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) memberIds!: string[];
  @IsDateString() startDate!: string;
  @IsInt() @Min(1) @Max(366) serviceDays!: number;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
  @IsString() @MinLength(8) @MaxLength(500) reason!: string;
}
