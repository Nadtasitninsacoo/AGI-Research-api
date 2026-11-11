import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { type AssetItem, SavedIpsService } from './saved-ips.service.js';
import { SyncTokenGuard } from './sync-token.guard.js';

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};

@Controller('api/saved-ips')
@UseGuards(SyncTokenGuard)
export class SavedIpsController {
  constructor(private readonly savedIps: SavedIpsService) {}

  /** GET /api/saved-ips -> { "ips": ["1.2.3.4", ...] } (authorized assets only). */
  @Get()
  async list(): Promise<{ ips: string[] }> {
    return { ips: await this.savedIps.getAuthorizedIps() };
  }

  /** GET /api/saved-ips/facets -> countries and open ports present in the vault, with IP counts. */
  @Get('facets')
  async facets() {
    return this.savedIps.facets();
  }

  /** GET /api/saved-ips/assets?q=&country=&port=&state=all|authorized|unauthorized&limit=&offset= */
  @Get('assets')
  async assets(@Query() query: Record<string, unknown>): Promise<{ total: number; items: AssetItem[] }> {
    const portText = text(query.port, 5);
    const port = portText === undefined ? undefined : Number(portText);
    if (port !== undefined && !(Number.isInteger(port) && port >= 1 && port <= 65535)) {
      throw new BadRequestException('port must be 1-65535');
    }
    const state = text(query.state, 16) ?? 'all';
    if (state !== 'all' && state !== 'authorized' && state !== 'unauthorized') {
      throw new BadRequestException('state must be all, authorized or unauthorized');
    }
    const limit = Math.min(200, Math.max(1, Number(text(query.limit, 4) ?? 50) || 50));
    const offset = Math.max(0, Number(text(query.offset, 9) ?? 0) || 0);
    return this.savedIps.searchAssets({ q: text(query.q, 100), country: text(query.country, 8), port, state, limit, offset });
  }

  /** POST /api/saved-ips/authorize { ips: string[], note?: string } — only IPs already in the vault. */
  @Post('authorize')
  async authorize(@Body() body: { ips?: unknown; note?: unknown }): Promise<{ authorized: number; ignored: number }> {
    return this.savedIps.authorize(body?.ips, text(body?.note, 255) ?? null);
  }

  /** POST /api/saved-ips/revoke { ips: string[] } */
  @Post('revoke')
  async revoke(@Body() body: { ips?: unknown }): Promise<{ revoked: number }> {
    return this.savedIps.revoke(body?.ips);
  }
}
