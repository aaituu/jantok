import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { RefundKind } from '@prisma/client';

export class PaymentCheckoutDto {
  @IsUUID() quoteId!: string;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
  @IsOptional() @IsBoolean() autoRenew = false;
  @IsOptional() @IsUrl({ require_tld: false }) returnUrl?: string;
}

export class RefundRequestDto {
  @IsUUID() purchaseId!: string;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @IsOptional() @IsDateString() simulationNow?: string;
}

export class AdminRefundDto extends RefundRequestDto {
  @IsEnum(RefundKind) kind: RefundKind = RefundKind.ADMIN_COMPENSATION;
  @IsInt() @Min(0) cashKzt!: number;
  @IsInt() @Min(0) bonusKzt!: number;
  @IsOptional() @IsInt() @Min(0) restoredServiceDays = 0;
}

export class ConfigureAutoRenewDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsUUID() paymentMethodId?: string;
  @IsOptional() @IsBoolean() termsAccepted = false;
}

export class RegisterReceiptDto {
  @IsUUID() purchaseId!: string;
  @IsOptional() @IsUUID() refundId?: string;
  @IsString() @MinLength(3) @MaxLength(256) externalDocumentRef!: string;
  @IsOptional() @IsUrl() documentUrl?: string;
  @IsString() @MinLength(8) @MaxLength(160) idempotencyKey!: string;
}
