import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ApiTokenGuard } from '../common/auth/api-token.guard.js';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard.js';
import { SecurityAssessmentService } from './security-assessment.service.js';
import { TaskRunnerService } from './tasks/task-runner.service.js';
import { AssessmentHandoffDto } from './dto/assessment-handoff.dto.js';
import { AssessmentHandoffService } from './assessment-handoff.service.js';

type AuthedRequest = { user?: { sub?: number; email?: string; role?: string } };

// Human-facing endpoints require a logged-in user (JWT from /api/auth/login).
// The engine handoff is service-to-service and uses the static service token.
@Controller('api/security-assessments')
export class SecurityAssessmentController {
  constructor(
    private readonly assessmentService: SecurityAssessmentService,
    private readonly taskRunner: TaskRunnerService,
    private readonly handoffService: AssessmentHandoffService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  listAssessments() {
    return this.assessmentService.listAssessments();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getAssessment(@Param('id', ParseIntPipe) id: number) {
    return this.assessmentService.getAssessment(id);
  }

  @Get(':id/tasks')
  @UseGuards(JwtAuthGuard)
  getTasks(@Param('id', ParseIntPipe) id: number) {
    return this.assessmentService.getTasks(id);
  }

  @Get(':id/findings')
  @UseGuards(JwtAuthGuard)
  getFindings(@Param('id', ParseIntPipe) id: number) {
    return this.assessmentService.getFindings(id);
  }

  // The single human approval button calls this. Requires login (JWT).
  @Post(':id/approve')
  @UseGuards(JwtAuthGuard)
  approve(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.assessmentService.approveAssessment(id, Number(req.user?.sub));
  }

  @Post(':id/tasks/initialize')
  @UseGuards(JwtAuthGuard)
  initializeTasks(@Param('id', ParseIntPipe) id: number) {
    return this.assessmentService.initializeTasks(id);
  }

  @Post(':id/tasks/run')
  @UseGuards(JwtAuthGuard)
  runTasks(@Param('id', ParseIntPipe) id: number) {
    return this.taskRunner.runQueuedTasks(id);
  }

  @Post('runs/:runId/handoff')
  @UseGuards(ApiTokenGuard)
  handoffRun(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: AssessmentHandoffDto,
  ) {
    return this.handoffService.handleRunCompletion(runId, dto);
  }
}
