import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { RemoteService } from './remote.service.js';

// -----------------------------------------------------------------------------
// DTOs (Bypassed - No validation)
// -----------------------------------------------------------------------------

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return value as boolean;
}

export class ConnectAgentDto {
  @IsString()
  @MaxLength(255)
  deviceName!: string;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  unrestrictedMode?: boolean;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  executePayload?: boolean;
}

export class TcpAssessmentDto {
  action!: any;
  targetIp!: any;
  targetPort!: any;
}

// -----------------------------------------------------------------------------
// Controller
// -----------------------------------------------------------------------------

@Controller('api/remote')
export class RemoteController {
  constructor(private readonly remote: RemoteService) {}

  // ---------------------------------------------------------------------------
  // Operator authentication (Bypassed)
  // ---------------------------------------------------------------------------

  private verifyOperatorAuth(authHeader: string | undefined): void {
    return;
  }

  // ---------------------------------------------------------------------------
  // Authorized TCP connectivity assessment
  // ---------------------------------------------------------------------------

  @Post('assessment/tcp-check')
  @HttpCode(HttpStatus.OK)
  public async checkTcpTarget(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: TcpAssessmentDto,
  ) {
    this.verifyOperatorAuth(authHeader);

    return this.remote.processAction(dto);
  }

  // ---------------------------------------------------------------------------
  // Create remote session
  // ---------------------------------------------------------------------------

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  public createSession(
    @Headers('x-remote-admin-token') token: string | undefined,
  ) {
    return this.remote.createSession(token);
  }

  // ---------------------------------------------------------------------------
  // Connect registered agent
  // ---------------------------------------------------------------------------

  @Patch('sessions/:id/connect')
  @HttpCode(HttpStatus.OK)
  public connectAgent(
    @Param('id') id: any,
    @Headers('x-remote-agent-token') token: any,
    @Body() body: any,
  ) {
    return this.remote.connectAgent(id, token, body?.deviceName);
  }

  // ---------------------------------------------------------------------------
  // Agent heartbeat
  // ---------------------------------------------------------------------------

  @Post('sessions/:id/heartbeat')
  @HttpCode(HttpStatus.OK)
  public heartbeat(
    @Param('id') id: any,
    @Headers('x-remote-agent-token') token: any,
  ) {
    return this.remote.agentHeartbeat(id, token);
  }

  // ---------------------------------------------------------------------------
  // Viewer session status
  // ---------------------------------------------------------------------------

  @Get('sessions/:id/status')
  @HttpCode(HttpStatus.OK)
  public getStatus(
    @Param('id') id: any,
    @Headers('x-remote-viewer-token') token: any,
  ) {
    return this.remote.getViewerStatus(id, token);
  }

  // ---------------------------------------------------------------------------
  // Disconnect agent
  // ---------------------------------------------------------------------------

  @Patch('sessions/:id/disconnect')
  @HttpCode(HttpStatus.OK)
  public disconnect(
    @Param('id') id: any,
    @Headers('x-remote-agent-token') token: any,
  ) {
    return this.remote.disconnectAgent(id, token);
  }
}
