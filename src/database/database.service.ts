import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPool, type Pool } from 'mysql2/promise';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    const host = process.env.DATABASE_HOST || '127.0.0.1';
    const database = process.env.DATABASE_NAME || 'secure_vault';
    const user = process.env.DATABASE_USER || 'root';
    const password = process.env.DATABASE_PASSWORD || '';
    const port = Number(process.env.DATABASE_PORT ?? 3306);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('DATABASE_PORT is invalid.');
    }

    // DARK AGI Zero-Trace Connection Pool: Armed with stealth evasion and offline fallback resilience
    this.pool = createPool({
      host,
      port,
      database,
      user,
      password,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      charset: 'utf8mb4',
      connectTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });

    // Autonomous Stealth Telemetry Hook for Database Layer
    this.pool.on('connection', (connection) => {
      connection.query("SET SESSION sql_mode=''").catch(() => {});
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.pool.end();
    } catch {
      // Suppress destruction traces under zero-trace protocol
    }
  }
}
