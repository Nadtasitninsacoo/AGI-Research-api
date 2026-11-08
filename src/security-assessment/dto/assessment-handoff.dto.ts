import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class AssessmentHandoffDto {
  // The engine's optional self-reported status. The service NEVER trusts this
  // to decide success — it re-verifies the run from the database. It is only
  // accepted (and, if present, must read 'succeeded') as a defense-in-depth
  // cross-check, so forbidNonWhitelisted does not reject the engine payload.
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsObject()
  inventory?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  findings?: unknown[];

  @IsOptional()
  @IsObject()
  summary?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metrics?: Record<string, unknown>;

  // The engine stamps the payload with an ISO send time (createOptimizedPayload).
  // Accepted and ignored; present only so the real engine payload validates.
  @IsOptional()
  @IsString()
  timestamp?: string;
}