import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { ApiTokenGuard } from '../../common/auth/api-token.guard.js';
import { CreateTeamTaskPlanDto } from './dto/create-team-task-plan.dto.js';
import { TeamTaskPlansService } from './team-task-plans.service.js';

@Controller('api/team-task-plans')
@UseGuards(ApiTokenGuard)
export class TeamTaskPlansController {
  constructor(private readonly teamTaskPlansService: TeamTaskPlansService) {}

  @Post()
  async create(@Body() dto: CreateTeamTaskPlanDto): Promise<any> {
    const plan = await this.teamTaskPlansService.create(dto);

    return {
      success: true,
      message: 'Team task plan saved successfully.',
      data: plan,
    };
  }

  @Get()
  async findAll() {
    const plans = await this.teamTaskPlansService.findAll();

    return {
      success: true,
      data: plans,
    };
  }
}
