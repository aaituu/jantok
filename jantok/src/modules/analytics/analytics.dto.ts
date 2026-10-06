import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() status?: string;
}

export class CreateExportDto extends AnalyticsQueryDto {
  @IsIn([
    'FINANCIAL',
    'KITCHEN',
    'INVENTORY',
    'CUSTOMERS',
    'SUBSCRIPTIONS',
    'DELIVERY',
    'WASTE',
    'MEALS',
  ])
  reportType!: string;
  @IsIn(['CSV', 'XLSX']) format!: 'CSV' | 'XLSX';
}
