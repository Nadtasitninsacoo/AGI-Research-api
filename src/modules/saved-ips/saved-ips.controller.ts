import { Controller, Get, UseGuards } from '@nestjs/common';
import { SavedIpsService } from './saved-ips.service.js';
import { SyncTokenGuard } from './sync-token.guard.js';

@Controller('api/saved-ips')
@UseGuards(SyncTokenGuard)
export class SavedIpsController {
  constructor(private readonly savedIps: SavedIpsService) {}

  /** GET /api/saved-ips -> { "ips": ["1.2.3.4", ...] } (authorized assets only). */
  @Get()
  async list(): Promise<{ ips: string[] }> {
    return { ips: await this.savedIps.getAuthorizedIps() };
  }
}
