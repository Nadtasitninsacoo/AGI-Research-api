import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { SavedIpsController } from './saved-ips.controller.js';
import { SavedIpsService } from './saved-ips.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [SavedIpsController],
  providers: [SavedIpsService],
})
export class SavedIpsModule {}
