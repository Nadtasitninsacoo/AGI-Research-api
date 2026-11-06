
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ApiTokenGuard } from '../../common/auth/api-token.guard.js';
import { CreateQueueDto } from './dto/create-queue.dto.js';
import { AgentTaskQueueService } from './agent-task-queue.service.js';

@Controller('api/agent-task-queue')
@UseGuards(ApiTokenGuard)
export class AgentTaskQueueController {
  constructor(
    private readonly queueService: AgentTaskQueueService,
  ) {}

  @Post()
  async create(
    @Body() dto: CreateQueueDto,
  ) {
    return {
      success: true,
      data: await this.queueService.create(dto),
    };
  }

  @Get()
  async findAll() {
    return {
      success: true,
      data: await this.queueService.findAll(),
    };
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return {
      success: true,
      data: await this.queueService.findOne(id),
    };
  }

  @Post(':id/assess')
  async assess(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return {
      success: true,
      data: await this.queueService.assess(id),
    };
  }
}
