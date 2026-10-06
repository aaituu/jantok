import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RequestOtpDto {
  @IsString() @MaxLength(24) phone!: string;
  @IsString() @Length(1, 128) deviceId!: string;
}

export class VerifyOtpDto extends RequestOtpDto {
  @IsString() @Length(4, 10) code!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) lastName?: string;
  @IsOptional() @IsString() @MaxLength(160) deviceName?: string;
  @IsOptional() @IsString() @MaxLength(32) referralCode?: string;
}

export class RefreshDto {
  @IsString() @MinLength(40) refreshToken!: string;
}

export class DeviceTokenDto {
  @IsString() @MinLength(16) @MaxLength(2048) token!: string;
  @IsString() @Length(1, 128) deviceId!: string;
  @IsIn(['ios', 'android', 'web']) platform!: string;
  @IsOptional() @IsString() @MaxLength(5) locale?: string;
}
