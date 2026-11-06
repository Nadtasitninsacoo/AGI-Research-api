
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AgentTaskQueueController } from './agent-task-queue.controller.js';
import { AgentTaskQueueService } from './agent-task-queue.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AgentTaskQueueController],
  providers: [AgentTaskQueueService],
  exports: [AgentTaskQueueService],
})
export class AgentTaskQueueModule {}
