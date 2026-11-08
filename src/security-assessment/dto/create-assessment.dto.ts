import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAssessmentDto {
  @IsInt()
  @Min(1)
  runId!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  targetReference!: string;

  // The authorized inventory to assess (hosts/services/configurations/permissions).
  // Optional; defaults to an empty object.
  @IsOptional()
  @IsObject()
  scopeSnapshot?: Record<string, unknown>;
}
