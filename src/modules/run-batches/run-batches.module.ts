import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { RunBatchesController } from './run-batches.controller.js';
import { RunBatchesService } from './run-batches.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [RunBatchesController],
  providers: [RunBatchesService],
  exports: [RunBatchesService],
})
export class RunBatchesModule {}