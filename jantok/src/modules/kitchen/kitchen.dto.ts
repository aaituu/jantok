import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  InventoryMovementType,
  PackingItemStatus,
  ProductionRevisionKind,
} from '@prisma/client';

export class GenerateProductionDto {
  @IsDateString() serviceDate!: string;
  @IsEnum(ProductionRevisionKind) kind!: ProductionRevisionKind;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) reason?: string;
}

export class ProductionLineActualDto {
  @IsInt() @Min(0) actualQuantity!: number;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
}

export class ConfirmProductionDto {
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(80) shiftCode?: string;
}

export class PackingItemDto {
  @IsEnum(PackingItemStatus) status!: PackingItemStatus;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
}

export class PackingTaskDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
}

export class SupplierDto {
  @IsString() @MinLength(2) @MaxLength(64) code!: string;
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(160) contactName?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
}

export class PurchaseItemDto {
  @IsUUID() ingredientId!: string;
  @IsUUID() storageLocationId!: string;
  @IsNumber() @Min(0.001) quantity!: number;
  @IsString() @MaxLength(16) unit!: string;
  @IsNumber() @Min(0) unitPriceKzt!: number;
}

export class SupplierPurchaseDto {
  @IsUUID() supplierId!: string;
  @IsString() @MinLength(2) @MaxLength(80) number!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[];
}

export class ReceivePurchaseItemDto {
  @IsNumber() @Min(0.001) quantity!: number;
  @IsString() @MaxLength(16) unit!: string;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
}

export class WasteDto {
  @IsUUID() ingredientId!: string;
  @IsUUID() storageLocationId!: string;
  @IsNumber() @Min(0.001) quantity!: number;
  @IsString() @MaxLength(16) unit!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @IsDateString() wasteDate!: string;
  @IsOptional() @IsString() @MaxLength(80) shiftCode?: string;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
}

export class InventoryMovementDto {
  @IsUUID() ingredientId!: string;
  @IsEnum(InventoryMovementType) type!: InventoryMovementType;
  @IsNumber() @Min(0.001) quantity!: number;
  @IsString() @MaxLength(16) unit!: string;
  @IsOptional() @IsUUID() sourceLocationId?: string;
  @IsOptional() @IsUUID() targetLocationId?: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
}

export class PrintDocumentDto {
  @IsIn(['PRODUCTION_LIST', 'PACKING_LIST', 'LABEL'])
  type!: 'PRODUCTION_LIST' | 'PACKING_LIST' | 'LABEL';
  @IsOptional() @IsUUID() revisionId?: string;
  @IsOptional() @IsUUID() packingTaskId?: string;
  @IsOptional() @IsUUID() reprintOfId?: string;
  @IsString() @MinLength(2) @MaxLength(40) pageSize!: string;
  @IsString() @MinLength(8) @MaxLength(128) idempotencyKey!: string;
  @IsOptional() @IsObject() layout?: Record<string, unknown>;
}
