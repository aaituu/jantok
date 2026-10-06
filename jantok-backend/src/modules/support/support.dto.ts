import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SupportAttachmentDto {
  @IsString() @MinLength(8) @MaxLength(500) objectKey!: string;
  @IsIn(['image/jpeg', 'image/png', 'image/webp']) contentType!:
    'image/jpeg' | 'image/png' | 'image/webp';
  @IsInt() @Min(1) @Max(5_000_000) sizeBytes!: number;
  @IsString() @MinLength(64) @MaxLength(64) sha256!: string;
}

export class CreateSupportThreadDto {
  @IsIn([
    'NOT_DELIVERED',
    'LATE',
    'DAMAGED',
    'TASTE',
    'WRONG_MEAL',
    'OTHER',
    'POSITIVE_FEEDBACK',
  ])
  reason!:
    | 'NOT_DELIVERED'
    | 'LATE'
    | 'DAMAGED'
    | 'TASTE'
    | 'WRONG_MEAL'
    | 'OTHER'
    | 'POSITIVE_FEEDBACK';
  @IsString() @MinLength(2) @MaxLength(160) subject!: string;
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  @IsString() @MinLength(8) @MaxLength(128) clientMessageId!: string;
  @IsOptional() @IsUUID() dailyFulfillmentId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => SupportAttachmentDto)
  attachments?: SupportAttachmentDto[];
}

export class SendSupportMessageDto {
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  @IsString() @MinLength(8) @MaxLength(128) clientMessageId!: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => SupportAttachmentDto)
  attachments?: SupportAttachmentDto[];
}

export class SupportStatusDto {
  @IsIn([
    'OPEN',
    'WAITING_FOR_CUSTOMER',
    'WAITING_FOR_SUPPORT',
    'RESOLVED',
    'CLOSED',
  ])
  status!:
    | 'OPEN'
    | 'WAITING_FOR_CUSTOMER'
    | 'WAITING_FOR_SUPPORT'
    | 'RESOLVED'
    | 'CLOSED';
  @IsString() @MinLength(4) @MaxLength(500) reason!: string;
}

export class NotificationPreferenceDto {
  @IsBoolean() servicePushEnabled!: boolean;
  @IsBoolean() marketingPushEnabled!: boolean;
  @IsIn(['kk', 'ru', 'en']) locale!: string;
}
