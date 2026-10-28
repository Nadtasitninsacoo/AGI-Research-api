
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { ResearchApiController } from './research-api.controller.js';
import { ResearchApiService } from './research-api.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ResearchApiController],
  providers: [ResearchApiService],
})
export class ResearchApiModule {}