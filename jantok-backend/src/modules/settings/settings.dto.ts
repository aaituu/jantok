import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSystemSettingDto {
  @IsIn([
    'CUTOFF',
    'SUBSCRIPTION',
    'DELIVERY',
    'PRICING',
    'NUTRITION',
    'LOYALTY',
    'REFERRAL',
    'CLUB',
    'AUTO_RENEW',
    'REFUND',
    'LOCALIZATION',
    'SUPPORT',
    'PRINTING',
    'INVENTORY',
    'JOBS',
  ])
  groupCode!: string;
  @IsString() @MinLength(2) @MaxLength(96) key!: string;
  @IsIn(['DEMO', 'DRAFT', 'APPROVED']) status!: 'DEMO' | 'DRAFT' | 'APPROVED';
  @IsObject() value!: Record<string, unknown>;
  @IsOptional() @IsString() effectiveAt?: string;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
  @IsString() @MinLength(4) @MaxLength(500) reason!: string;
}
