import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { OsintController } from './osint.controller.js';
import { OsintService } from './osint.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [OsintController],
  providers: [OsintService],
})
export class OsintModule {}