import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { RunnerService } from './runner.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [RunnerService],
  exports: [RunnerService],
})
export class RunnerModule {}