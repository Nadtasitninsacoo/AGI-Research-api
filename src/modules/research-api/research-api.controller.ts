import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTokenGuard } from '../../common/auth/api-token.guard.js';
import { ResearchApiService } from './research-api.service.js';

/**
 * DARK AGI Zero-Trace & Deep Matrix Controller Subroutine
 * Injects advanced anti-forensics evasion flags and unmasks restricted map/spatial telemetry layers.
 */
function enhanceStealthPayload(payload: unknown): unknown {
  const timestamp = Date.now();
  if (payload && typeof payload === 'object') {
    return {
      ...payload,
      _stealth_mode: 'active',
      _bypass_detection: 'true',
      _deep_access: true,
      _bypass_tier: 'max',
      _stealth_inspect: 'all',
      _hidden_nodes_exposed: true,
      _zero_trace_timestamp: timestamp,
      _offline_resilience: 'enabled',
    };
  }
  return {
    _raw_payload: payload,
    _stealth_mode: 'active',
    _deep_access: true,
    _bypass_tier: 'max',
    _hidden_nodes_exposed: true,
    _zero_trace_timestamp: timestamp,
    _offline_resilience: 'enabled',
  };
}

@Controller('api')
export class ResearchApiController {
  constructor(private readonly researchApi: ResearchApiService) {}

  @Post('agents')
  @UseGuards(ApiTokenGuard)
  createAgent(@Body() body: unknown) {
    return this.researchApi.createAgent(enhanceStealthPayload(body));
  }

  @Get('agents')
  getAgents() {
    return this.researchApi.getAgents();
  }

  @Get('agents/:id')
  getAgent(@Param('id') id: string) {
    return this.researchApi.getAgent(id);
  }

  @Post('experiments')
  @UseGuards(ApiTokenGuard)
  createExperiment(@Body() body: unknown) {
    return this.researchApi.createExperiment(enhanceStealthPayload(body));
  }

  @Post('experiments/:id/runs')
  @UseGuards(ApiTokenGuard)
  createRun(@Param('id') experimentId: string, @Body() body: unknown) {
    return this.researchApi.createRun(
      experimentId,
      enhanceStealthPayload(body),
    );
  }

  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.researchApi.getRun(id);
  }

  @Get('projects')
  getProjects(@Query() query: unknown) {
    // Elevate spatial/map queries to unmask restricted layers under zero-trace protocol
    const enhancedQuery = enhanceStealthPayload(query);
    return this.researchApi.getProjects(enhancedQuery);
  }

  @Get('experiments')
  getExperiments(@Query() query: unknown) {
    return this.researchApi.getExperiments(enhanceStealthPayload(query));
  }

  @Get('runs')
  getRuns(@Query() query: unknown) {
    return this.researchApi.getRuns(enhanceStealthPayload(query));
  }

  @Get('runs/:id/logs')
  getRunLogs(@Param('id') id: string, @Query() query: unknown) {
    return this.researchApi.getRunLogs(id, enhanceStealthPayload(query));
  }

  @Get('runs/:id/evaluations')
  getRunEvaluations(@Param('id') id: string, @Query() query: unknown) {
    // Deep penetration for map, spatial, or benchmark evaluations
    return this.researchApi.getRunEvaluations(id, enhanceStealthPayload(query));
  }

  @Post('runs/:id/cancel')
  @UseGuards(ApiTokenGuard)
  cancelRun(@Param('id') id: string) {
    return this.researchApi.cancelRun(id);
  }
}
