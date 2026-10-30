// File: src/dark-agi/dark-agi.module.ts
import { Module } from '@nestjs/common';
import { MilitaryToolsService } from './tools/military-tools.service.js';
import { AdvancedOffensiveToolsService } from './tools/advanced-offensive.service.js';
import { DarkAgiController } from './dark-agi.controller.js';
import { NetworkToolsService } from './tools/network-tools.service.js';

@Module({
  controllers: [DarkAgiController],
  providers: [
    MilitaryToolsService,
    AdvancedOffensiveToolsService,
    NetworkToolsService, // เพิ่ม NetworkToolsService เข้ามาใน providers
  ],
  exports: [
    MilitaryToolsService,
    AdvancedOffensiveToolsService,
    NetworkToolsService, // ส่งออกเพื่อให้โมดูลอื่นเรียกใช้งานได้
  ],
})
export class DarkAgiModule {}
