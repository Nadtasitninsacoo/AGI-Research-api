// File: src/dark-agi/dark-agi.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { MilitaryToolsService } from './tools/military-tools.service.js';
import { AdvancedOffensiveToolsService } from './tools/advanced-offensive.service.js'; // <--- 1. เพิ่มการ Import Service ใหม่

@Controller('dark-agi')
export class DarkAgiController {
  constructor(
    private readonly militaryToolsService: MilitaryToolsService,
    private readonly advancedOffensiveToolsService: AdvancedOffensiveToolsService, // <--- 2. ฉีดเข้า Constructor
  ) {}

  @Post('run-command')
  async executeCommand(@Body() body: { command: string; shellType?: string }) {
    return await this.militaryToolsService.runCommand(
      body.command,
      body.shellType,
    );
  }

  @Post('port-scan')
  async portScan(@Body() body: { target: string; ports: string }) {
    return await this.militaryToolsService.portScan(body.target, body.ports);
  }

  @Post('dns-lookup')
  async dnsLookup(@Body() body: { domain: string }) {
    return await this.militaryToolsService.dnsLookup(body.domain);
  }

  // --- เพิ่ม Endpoint สำหรับชุดเครื่องมือขั้นสูง (Advanced Offensive Tools) ---

  @Post('dump-credentials')
  async dumpCredentials() {
    return await this.advancedOffensiveToolsService.dumpCredentials();
  }

  @Post('establish-tunnel')
  async establishTunnel(
    @Body() body: { remoteHost: string; localPort: number },
  ) {
    return await this.advancedOffensiveToolsService.establishCovertTunnel(
      body.remoteHost,
      body.localPort,
    );
  }
}
