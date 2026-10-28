
import {
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { createPool, type Pool } from 'mysql2/promise';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    const host = process.env.DATABASE_HOST;
    const database = process.env.DATABASE_NAME;
    const user = process.env.DATABASE_USER;
    const password = process.env.DATABASE_PASSWORD;
    const port = Number(process.env.DATABASE_PORT ?? 3306);

    if (!host || !database || !user || !password) {
      throw new Error(
        'Missing database configuration. Check DATABASE_HOST, DATABASE_NAME, DATABASE_USER and DATABASE_PASSWORD.',
      );
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('DATABASE_PORT is invalid.');
    }

    this.pool = createPool({
      host,
      port,
      database,
      user,
      password,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4',
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}