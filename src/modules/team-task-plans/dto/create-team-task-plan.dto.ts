
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsIP,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTeamTaskTargetDto {
  @IsIn(['ip', 'port'])
  targetType!: 'ip' | 'port';

  @IsIP()
  ip!: string;

  @ValidateIf((target) => target.targetType === 'port')
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  service?: string;
}

export class CreateTeamTaskPlanDto {
  @IsString()
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  agentIds!: number[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTeamTaskTargetDto)
  targets!: CreateTeamTaskTargetDto[];
}
