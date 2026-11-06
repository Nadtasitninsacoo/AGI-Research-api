
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  createPool,
  type Pool,
} from 'mysql2/promise';

@Injectable()
export class DatabaseService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);

  readonly pool: Pool;

  constructor() {
    const host = process.env.DATABASE_HOST ?? '127.0.0.1';
    const database = (process.env.DATABASE_NAME ?? '').trim();
    const user = (process.env.DATABASE_USER ?? '').trim();
    const password = (process.env.DATABASE_PASSWORD ?? '').trim();
    const port = Number(process.env.DATABASE_PORT ?? 3306);

    if (!host || !database || !user || !password) {
      throw new Error('Missing database configuration.');
    }

    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new Error('DATABASE_PORT is invalid.');
    }

    this.pool = createPool({
      host,
      port,
      database,
      user,
      password,

      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 100,

      charset: 'utf8mb4',
      connectTimeout: 10000,

      enableKeepAlive: true,
      keepAliveInitialDelay: 0,

      multipleStatements: false,
      dateStrings: false,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');

      this.logger.log(
        'MySQL database connection established.',
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown database connection error';

      this.logger.error(
        `MySQL connection failed: ${message}`,
      );

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.pool.end();

      this.logger.log(
        'MySQL connection pool closed.',
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown database shutdown error';

      this.logger.error(
        `MySQL shutdown failed: ${message}`,
      );

      throw error;
    }
  }
}
