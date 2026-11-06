
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { RemoteController } from './remote.controller.js';
import { RemoteService } from './remote.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [RemoteController],
  providers: [RemoteService],
  exports: [RemoteService],
})
export class RemoteModule {}
