import {
  IsIP,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRunBatchDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  planId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  batchSize!: number;

  @IsOptional()
  @IsIP()
  ip?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  country?: string;
}