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
import { CreateRunBatchDto } from './dto/create-run-batch.dto.js';
import { RunBatchesService } from './run-batches.service.js';

@Controller('api/run-batches')
@UseGuards(ApiTokenGuard)
export class RunBatchesController {
  constructor(private readonly runBatchesService: RunBatchesService) {}

  @Post()
  async create(@Body() dto: CreateRunBatchDto) {
    return {
      success: true,
      data: await this.runBatchesService.create(dto),
    };
  }

  @Get()
  async findAll() {
    return {
      success: true,
      data: await this.runBatchesService.findAll(),
    };
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return {
      success: true,
      data: await this.runBatchesService.findOne(id),
    };
  }

  @Post(':id/assess')
  async assess(@Param('id', ParseIntPipe) id: number) {
    return {
      success: true,
      data: await this.runBatchesService.assess(id),
    };
  }
}
