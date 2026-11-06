
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateQueueDto {
  @IsInt()
  @Min(1)
  planId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  targetIds!: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  experimentId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  taskName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  taskDescription?: string;
}
