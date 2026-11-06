
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { TeamTaskPlansController } from './team-task-plans.controller.js';
import { TeamTaskPlansService } from './team-task-plans.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [TeamTaskPlansController],
  providers: [TeamTaskPlansService],
  exports: [TeamTaskPlansService],
})
export class TeamTaskPlansModule {}