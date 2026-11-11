import { BadRequestException, Injectable } from '@nestjs/common';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { DatabaseService } from '../../database/database.service.js';

interface IpRow extends RowDataPacket {
  ip: string;
}

interface AssetRow extends RowDataPacket {
  ip: string;
  country: string | null;
  city: string | null;
  region: string | null;
  source: string;
  authorized: number;
}

interface PortRow extends RowDataPacket {
  ip: string;
  port: number;
  service: string | null;
}

export interface AssetQuery {
  q?: string;
  country?: string;
  port?: number;
  state: 'all' | 'authorized' | 'unauthorized';
  limit: number;
  offset: number;
}

export interface AssetItem {
  ip: string;
  country: string | null;
  city: string | null;
  region: string | null;
  source: string;
  ports: { port: number; service: string | null }[];
  authorized: boolean;
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const MAX_IPS_PER_CALL = 2000;

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

  /**
   * Browse the vault so a person can pick what to authorize: filter by free text
   * (IP / city / country), country code, or an open port, and see each IP's open
   * ports and whether it is already authorized. Read-only.
   */
  async searchAssets(query: AssetQuery): Promise<{ total: number; items: AssetItem[] }> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
      where.push('(si.ip LIKE ? OR si.country LIKE ? OR si.city LIKE ? OR si.region LIKE ?)');
      params.push(like, like, like, like);
    }
    if (query.country) {
      where.push('si.country = ?');
      params.push(query.country.toUpperCase());
    }
    if (query.port !== undefined) {
      where.push('EXISTS (SELECT 1 FROM saved_ports sp WHERE sp.ip = si.ip AND sp.port = ?)');
      params.push(query.port);
    }
    if (query.state === 'authorized') where.push('a.entry IS NOT NULL');
    if (query.state === 'unauthorized') where.push('a.entry IS NULL');
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM saved_ips AS si LEFT JOIN authorized_scope AS a ON a.entry = si.ip ${clause}`;

    const [[countRow]] = await this.database.pool.query<RowDataPacket[][]>(`SELECT COUNT(*) AS n ${from}`, params);
    const [rows] = await this.database.pool.query<AssetRow[]>(
      `SELECT si.ip, si.country, si.city, si.region, si.source, (a.entry IS NOT NULL) AS authorized
         ${from} ORDER BY si.ip LIMIT ? OFFSET ?`,
      [...params, query.limit, query.offset],
    );

    const ports = new Map<string, { port: number; service: string | null }[]>();
    if (rows.length > 0) {
      const [portRows] = await this.database.pool.query<PortRow[]>(
        'SELECT ip, port, service FROM saved_ports WHERE ip IN (?) ORDER BY port',
        [rows.map((r) => r.ip)],
      );
      for (const p of portRows) {
        const list = ports.get(p.ip) ?? [];
        list.push({ port: p.port, service: p.service });
        ports.set(p.ip, list);
      }
    }

    return {
      total: Number((countRow as unknown as { n: number }).n ?? 0),
      items: rows.map((r) => ({
        ip: r.ip,
        country: r.country,
        city: r.city,
        region: r.region,
        source: r.source,
        ports: ports.get(r.ip) ?? [],
        authorized: Boolean(r.authorized),
      })),
    };
  }

  /** Distinct countries and open ports present in the vault (with IP counts) — feeds the filter dropdowns. */
  async facets(): Promise<{
    countries: { code: string; count: number }[];
    ports: { port: number; service: string | null; count: number }[];
  }> {
    const [countries] = await this.database.pool.query<RowDataPacket[]>(
      `SELECT country AS code, COUNT(*) AS n FROM saved_ips
        WHERE country IS NOT NULL AND country <> '' GROUP BY country ORDER BY n DESC, code`,
    );
    const [ports] = await this.database.pool.query<RowDataPacket[]>(
      `SELECT port, MAX(service) AS service, COUNT(DISTINCT ip) AS n FROM saved_ports
        GROUP BY port ORDER BY n DESC, port LIMIT 300`,
    );
    return {
      countries: countries.map((r) => ({ code: String(r.code), count: Number(r.n) })),
      ports: ports.map((r) => ({ port: Number(r.port), service: r.service ? String(r.service) : null, count: Number(r.n) })),
    };
  }

  private cleanIps(raw: unknown): string[] {
    if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
      throw new BadRequestException('"ips" must be an array of strings');
    }
    const ips = [...new Set((raw as string[]).map((v) => v.trim()))];
    if (ips.length === 0) throw new BadRequestException('No IPs given');
    if (ips.length > MAX_IPS_PER_CALL) throw new BadRequestException(`At most ${MAX_IPS_PER_CALL} IPs per call`);
    const bad = ips.find((ip) => !IPV4.test(ip));
    if (bad) throw new BadRequestException(`Not a valid IPv4 address: ${bad.slice(0, 64)}`);
    return ips;
  }

  /** Authorize IPs that exist in the vault. IPs not in the vault are ignored (and counted). */
  async authorize(rawIps: unknown, note: string | null): Promise<{ authorized: number; ignored: number }> {
    const ips = this.cleanIps(rawIps);
    await this.database.pool.query<ResultSetHeader>(
      `INSERT INTO authorized_scope (entry, note)
       SELECT ip, ? FROM saved_ips WHERE ip IN (?)
       ON DUPLICATE KEY UPDATE note = COALESCE(VALUES(note), note)`,
      [note, ips],
    );
    const [[row]] = await this.database.pool.query<RowDataPacket[][]>(
      'SELECT COUNT(*) AS n FROM saved_ips WHERE ip IN (?)',
      [ips],
    );
    const inVault = Number((row as unknown as { n: number }).n ?? 0);
    return { authorized: inVault, ignored: ips.length - inVault };
  }

  async revoke(rawIps: unknown): Promise<{ revoked: number }> {
    const ips = this.cleanIps(rawIps);
    const [res] = await this.database.pool.query<ResultSetHeader>('DELETE FROM authorized_scope WHERE entry IN (?)', [ips]);
    return { revoked: res.affectedRows };
  }
}
