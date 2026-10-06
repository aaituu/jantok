import { IsDateString, IsOptional } from 'class-validator';

export class MenuQueryDto {
  @IsOptional() @IsDateString() from?: string;
}
