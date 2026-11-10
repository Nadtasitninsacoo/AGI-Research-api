import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import { DatabaseService } from '../../database/database.service.js';

interface IpRow extends RowDataPacket {
  ip: string;
}

@Injectable()
export class SavedIpsService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Returns ONLY the IPs we are authorized to act on: a saved IP is included
   * solely when it also appears as an entry in `authorized_scope`. This is an
   * explicit allowlist — the scanned/geolocated third-party rows in saved_ips
   * (source='map_probe', 'dark_agi_probe', …) are NOT returned just because
   * they sit in the vault. Until authorized_scope is populated this correctly
   * returns an empty list.
   */
  async getAuthorizedIps(): Promise<string[]> {
    const [rows] = await this.database.pool.query<IpRow[]>(
      `SELECT si.ip
         FROM saved_ips AS si
         JOIN authorized_scope AS a ON a.entry = si.ip
        ORDER BY si.ip`,
    );
    return rows.map((r) => r.ip);
  }
}
