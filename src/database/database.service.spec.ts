import { createPool } from 'mysql2/promise';
import { DatabaseService } from './database.service.js';

vi.mock('mysql2/promise', () => ({
  createPool: vi.fn(() => ({ end: vi.fn().mockResolvedValue(undefined) })),
}));

const SECRET = 'S3cret-should-never-appear';

function setEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    DATABASE_HOST: '127.0.0.1',
    DATABASE_NAME: 'agi_research',
    DATABASE_USER: 'agi_app',
    DATABASE_PASSWORD: SECRET,
    DATABASE_PORT: '3306',
    ...overrides,
  };

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value as string);
  }
}

describe('DatabaseService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('creates a pool from the environment', () => {
    setEnv();

    new DatabaseService();

    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 3306,
        database: 'agi_research',
        user: 'agi_app',
        password: SECRET,
      }),
    );
  });

  it('defaults the port to 3306', () => {
    setEnv();
    vi.stubEnv('DATABASE_PORT', undefined as never);
    delete process.env.DATABASE_PORT;

    new DatabaseService();

    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3306 }),
    );
  });

  it.each([
    'DATABASE_HOST',
    'DATABASE_NAME',
    'DATABASE_USER',
    'DATABASE_PASSWORD',
  ])('throws when %s is missing, without leaking secrets', (key) => {
    setEnv();
    vi.stubEnv(key, '');

    let message = '';

    try {
      new DatabaseService();
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('Missing database configuration');
    expect(message).not.toContain(SECRET);
    expect(createPool).not.toHaveBeenCalled();
  });

  it.each(['0', '70000', 'abc', '3306.5'])(
    'rejects invalid port %s',
    (port) => {
      setEnv({ DATABASE_PORT: port });

      expect(() => new DatabaseService()).toThrow('DATABASE_PORT is invalid.');
    },
  );

  it('closes the pool on module destroy', async () => {
    setEnv();

    const service = new DatabaseService();
    await service.onModuleDestroy();

    expect(service.pool.end).toHaveBeenCalledTimes(1);
  });
});
