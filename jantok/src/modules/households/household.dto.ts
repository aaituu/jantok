import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  AllergyDeclarationStatus,
  BiologicalSex,
  GoalType,
  PortionPreference,
  PreferenceKind,
  SportIntensity,
} from '@prisma/client';

export class CreateMemberDto {
  @IsString() @MinLength(1) @MaxLength(100) firstName!: string;
  @IsDateString() birthDate!: string;
}
export class AllergyDto {
  @IsOptional() @IsUUID() allergenId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) freeText?: string;
}
export class PreferenceDto {
  @IsUUID() ingredientId!: string;
  @IsEnum(PreferenceKind) kind!: PreferenceKind;
}
export class QuestionnaireDto {
  @IsEnum(BiologicalSex) biologicalSex!: BiologicalSex;
  @IsNumber() @Min(30) @Max(260) heightCm!: number;
  @IsNumber() @Min(2) @Max(500) weightKg!: number;
  @IsUUID() activityLevelId!: string;
  @IsEnum(SportIntensity) sportIntensity!: SportIntensity;
  @IsNumber() @Min(0) @Max(168) sportHoursPerWeek!: number;
  @IsOptional() @IsString() @MaxLength(500) sportNotes?: string;
  @IsEnum(GoalType) goal!: GoalType;
  @IsUUID() dietTypeId!: string;
  @IsEnum(AllergyDeclarationStatus)
  allergyDeclarationStatus!: AllergyDeclarationStatus;
  @IsEnum(PortionPreference) portionPreference!: PortionPreference;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  sportTypeIds!: string[];
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllergyDto)
  allergies!: AllergyDto[];
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreferenceDto)
  preferences!: PreferenceDto[];
}
export class AddressDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) label?: string;
  @IsString() @MinLength(1) @MaxLength(240) streetAddress!: string;
  @IsOptional() @IsString() @MaxLength(32) apartment?: string;
  @IsOptional() @IsString() @MaxLength(32) entrance?: string;
  @IsOptional() @IsString() @MaxLength(16) floor?: string;
  @IsOptional() @IsString() @MaxLength(32) intercom?: string;
  @IsOptional() @IsString() @MaxLength(500) deliveryInstructions?: string;
  @IsOptional() @IsString() @MaxLength(500) landmarks?: string;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsUUID() deliverySlotId?: string;
  @IsOptional() @IsString() windowStart?: string;
  @IsOptional() @IsString() windowEnd?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateAddressDto extends AddressDto {
  @IsNumber() @Min(0) version!: number;
}

export class SelectServiceDayAddressDto {
  @IsUUID() serviceDayId!: string;
  @IsUUID() addressId!: string;
  @IsUUID() deliverySlotId!: string;
  @IsNumber() @Min(0) expectedVersion!: number;
}
