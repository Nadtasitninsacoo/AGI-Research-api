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

@Controller('api')
export class ResearchApiController {
  constructor(private readonly researchApi: ResearchApiService) {}

  @Post('agents')
  @UseGuards(ApiTokenGuard)
  createAgent(@Body() body: unknown) {
    return this.researchApi.createAgent(body);
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
    return this.researchApi.createExperiment(body);
  }

  @Post('experiments/:id/runs')
  @UseGuards(ApiTokenGuard)
  createRun(@Param('id') experimentId: string, @Body() body: unknown) {
    return this.researchApi.createRun(experimentId, body);
  }

  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.researchApi.getRun(id);
  }

  @Get('projects')
  getProjects(@Query() query: unknown) {
    return this.researchApi.getProjects(query);
  }

  @Get('experiments')
  getExperiments(@Query() query: unknown) {
    return this.researchApi.getExperiments(query);
  }

  @Get('runs')
  getRuns(@Query() query: unknown) {
    return this.researchApi.getRuns(query);
  }

  @Get('runs/:id/logs')
  getRunLogs(@Param('id') id: string, @Query() query: unknown) {
    return this.researchApi.getRunLogs(id, query);
  }

  @Get('runs/:id/evaluations')
  getRunEvaluations(@Param('id') id: string, @Query() query: unknown) {
    return this.researchApi.getRunEvaluations(id, query);
  }

  @Post('runs/:id/cancel')
  @UseGuards(ApiTokenGuard)
  cancelRun(@Param('id') id: string) {
    return this.researchApi.cancelRun(id);
  }
}
