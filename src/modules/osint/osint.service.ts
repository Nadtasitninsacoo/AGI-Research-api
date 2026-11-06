
import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import { DatabaseService } from '../../database/database.service.js';

export interface OsintBar {
  label: string;
  n: number;
}

export interface OsintIpOverview {
  total: number;
  countries: number;
  scanned: number;
  unscanned: number;
  topCountry: OsintBar[];
  topCity: OsintBar[];
}

export interface OsintPortOverview {
  total: number;
  ips: number;
  services: number;
  vulnHosts: number;
  safeHosts: number;
  topService: OsintBar[];
  topPort: OsintBar[];
}

export interface OsintOverviewData {
  status: 'ok';
  source: 'mysql';
  ips: OsintIpOverview;
  ports: OsintPortOverview;
  generatedAt: string;
}

interface IpSummaryRow extends RowDataPacket {
  total: number | string;
  countries: number | string;
  scanned: number | string | null;
  unscanned: number | string | null;
}

interface PortSummaryRow extends RowDataPacket {
  total: number | string;
  ips: number | string;
  services: number | string;
  vulnHosts: number | string;
  safeHosts: number | string;
}

interface BarRow extends RowDataPacket {
  label: string | number;
  n: number | string;
}

@Injectable()
export class OsintService {
  constructor(private readonly database: DatabaseService) {}

  async getOverview(): Promise<OsintOverviewData> {
    const pool = this.database.pool;

    const [
      [ipSummaryRows],
      [countryRows],
      [cityRows],
      [portSummaryRows],
      [serviceRows],
      [portRows],
    ] = await Promise.all([
      pool.query<IpSummaryRow[]>(`
        SELECT
          COUNT(*) AS total,
          COUNT(DISTINCT country) AS countries,
          COALESCE(SUM(scanned_at IS NOT NULL), 0) AS scanned,
          COALESCE(SUM(scanned_at IS NULL), 0) AS unscanned
        FROM saved_ips
      `),

      pool.query<BarRow[]>(`
        SELECT
          country AS label,
          COUNT(*) AS n
        FROM saved_ips
        WHERE country IS NOT NULL
          AND country <> ''
        GROUP BY country
        ORDER BY n DESC
        LIMIT 7
      `),

      pool.query<BarRow[]>(`
        SELECT
          COALESCE(NULLIF(city, ''), '?') AS label,
          COUNT(*) AS n
        FROM saved_ips
        GROUP BY label
        ORDER BY n DESC
        LIMIT 7
      `),

      pool.query<PortSummaryRow[]>(`
        SELECT
          COUNT(*) AS total,
          COUNT(DISTINCT ip) AS ips,
          COUNT(DISTINCT service) AS services,

          (
            SELECT COUNT(*)
            FROM (
              SELECT ip
              FROM saved_ports
              GROUP BY ip
              HAVING MAX(CASE WHEN COALESCE(cves, 0) > 0 THEN 1 ELSE 0 END) = 1
            ) AS vulnerable_hosts
          ) AS vulnHosts,

          (
            SELECT COUNT(*)
            FROM (
              SELECT ip
              FROM saved_ports
              GROUP BY ip
              HAVING MAX(CASE WHEN COALESCE(cves, 0) > 0 THEN 1 ELSE 0 END) = 0
            ) AS safe_hosts
          ) AS safeHosts

        FROM saved_ports
      `),

      pool.query<BarRow[]>(`
        SELECT
          COALESCE(NULLIF(service, ''), '?') AS label,
          COUNT(*) AS n
        FROM saved_ports
        GROUP BY label
        ORDER BY n DESC
        LIMIT 7
      `),

      pool.query<BarRow[]>(`
        SELECT
          port AS label,
          COUNT(*) AS n
        FROM saved_ports
        GROUP BY port
        ORDER BY n DESC
        LIMIT 7
      `),
    ]);

    const ipSummary = ipSummaryRows[0];
    const portSummary = portSummaryRows[0];

    if (!ipSummary || !portSummary) {
      throw new Error('OSINT overview query returned no summary rows.');
    }

    return {
      status: 'ok',
      source: 'mysql',

      ips: {
        total: Number(ipSummary.total),
        countries: Number(ipSummary.countries),
        scanned: Number(ipSummary.scanned ?? 0),
        unscanned: Number(ipSummary.unscanned ?? 0),

        topCountry: countryRows.map((row) => ({
          label: String(row.label),
          n: Number(row.n),
        })),

        topCity: cityRows.map((row) => ({
          label: String(row.label),
          n: Number(row.n),
        })),
      },

      ports: {
        total: Number(portSummary.total),
        ips: Number(portSummary.ips),
        services: Number(portSummary.services),
        vulnHosts: Number(portSummary.vulnHosts),
        safeHosts: Number(portSummary.safeHosts),

        topService: serviceRows.map((row) => ({
          label: String(row.label),
          n: Number(row.n),
        })),

        topPort: portRows.map((row) => ({
          label: String(row.label),
          n: Number(row.n),
        })),
      },

      generatedAt: new Date().toISOString(),
    };
  }
}
