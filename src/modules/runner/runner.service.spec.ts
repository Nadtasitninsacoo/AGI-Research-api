import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RunnerService } from './runner.service.js';
import { DatabaseService } from '../../database/database.service.js';

const { mockCreate } = vi.hoisted(() => {
  return {
    mockCreate: vi.fn(),
  };
});

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn(function () {
      return {
        messages: {
          create: mockCreate,
        },
      };
    }),
  };
});

describe('RunnerService', () => {
  let service: RunnerService;
  let dbService: {
    pool: {
      query: ReturnType<typeof vi.fn>;
      getConnection: ReturnType<typeof vi.fn>;
    };
  };
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.RUNNER_ENABLED = 'true';
    process.env.RUNNER_MAX_RUNS_PER_HOUR = '20';

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Mock model response' }],
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    dbService = {
      pool: {
        query: vi.fn(),
        getConnection: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunnerService,
        {
          provide: DatabaseService,
          useValue: dbService,
        },
      ],
    }).compile();

    service = module.get<RunnerService>(RunnerService);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should do nothing if RUNNER_ENABLED is not true', async () => {
    process.env.RUNNER_ENABLED = 'false';
    await service.handleQueue();
    expect(dbService.pool.getConnection).not.toHaveBeenCalled();
  });

  it('should do nothing if ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    // Re-instantiate service to trigger missing api key logic in constructor
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunnerService,
        { provide: DatabaseService, useValue: dbService },
      ],
    }).compile();
    const localService = module.get<RunnerService>(RunnerService);

    await localService.handleQueue();
    expect(dbService.pool.getConnection).not.toHaveBeenCalled();
  });

  it('should skip if no queued runs found', async () => {
    dbService.pool.query.mockResolvedValueOnce([[{ count: 0 }]]); // hourly count

    const mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue([[]]), // no runs
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    dbService.pool.getConnection.mockResolvedValue(mockConnection);

    await service.handleQueue();
    expect(dbService.pool.query).toHaveBeenCalled();
    expect(mockConnection.commit).toHaveBeenCalled();
  });

  it('should skip if hourly limit reached (does not call getConnection)', async () => {
    dbService.pool.query.mockResolvedValueOnce([[{ count: 20 }]]); // limit reached

    await service.handleQueue();
    expect(dbService.pool.getConnection).not.toHaveBeenCalled();
  });

  it('should fail run if agent or model is missing', async () => {
    dbService.pool.query.mockResolvedValueOnce([[{ count: 0 }]]);

    const mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue([
        [
          {
            id: 'run-1',
            experiment_id: 'exp-1',
            params: { prompt: 'hello' },
            agent_id: null,
            model: null,
            agent_status: 'idle',
          },
        ],
      ]),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    dbService.pool.getConnection.mockResolvedValue(mockConnection);

    await service.handleQueue();
    expect(mockConnection.execute).toHaveBeenCalledTimes(2);
    expect(mockConnection.commit).toHaveBeenCalled();
  });

  it('should successfully process a queued run with object params, metrics, agent_logs, and agent back to idle', async () => {
    dbService.pool.query
      .mockResolvedValueOnce([[{ count: 0 }]]) // hourly count
      .mockResolvedValueOnce([]) // update run success
      .mockResolvedValueOnce([]) // update agent idle
      .mockResolvedValueOnce([]); // insert log

    const mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          [
            {
              id: 'run-1',
              experiment_id: 'exp-1',
              params: { prompt: 'Object prompt test' },
              agent_id: 'agent-1',
              model: 'claude-haiku-5-5',
              agent_status: 'idle',
            },
          ],
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    dbService.pool.getConnection.mockResolvedValue(mockConnection);

    await service.handleQueue();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Object prompt test' }],
      }),
    );
    expect(dbService.pool.query).toHaveBeenCalledTimes(4);
  });

  it('should handle model error securely without leaking raw messages', async () => {
    mockCreate.mockRejectedValueOnce(
      new Error('Sensitive upstream API key error 12345'),
    );

    dbService.pool.query
      .mockResolvedValueOnce([[{ count: 0 }]])
      .mockResolvedValueOnce([]) // update run failed
      .mockResolvedValueOnce([]) // update agent idle
      .mockResolvedValueOnce([]); // insert log error

    const mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          [
            {
              id: 'run-1',
              experiment_id: 'exp-1',
              params: { prompt: 'Error test' },
              agent_id: 'agent-1',
              model: 'claude-haiku-5-5',
              agent_status: 'idle',
            },
          ],
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    dbService.pool.getConnection.mockResolvedValue(mockConnection);

    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await service.handleQueue();

    // The raw upstream message must never reach the server log either.
    const logged = JSON.stringify(errorSpy.mock.calls);
    errorSpy.mockRestore();

    expect(logged).toContain('Model execution error for run run-1');
    expect(logged).toContain('Error');
    expect(logged).not.toContain('Sensitive upstream');
    expect(logged).not.toContain('12345');

    // Verify general error message is saved, not raw error
    expect(dbService.pool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['failed', 'Model execution failed securely']),
    );
  });

  it('should recover if DB persistence fails after model execution', async () => {
    dbService.pool.query
      .mockResolvedValueOnce([[{ count: 0 }]])
      .mockRejectedValueOnce(
        Object.assign(new Error('DB connection lost password=hunter2'), {
          code: 'PROTOCOL_CONNECTION_LOST',
        }),
      ); // fail persistence

    const mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          [
            {
              id: 'run-1',
              experiment_id: 'exp-1',
              params: { prompt: 'Recovery test' },
              agent_id: 'agent-1',
              model: 'claude-haiku-5-5',
              agent_status: 'idle',
            },
          ],
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    dbService.pool.getConnection.mockResolvedValue(mockConnection);

    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    // Should not throw, should run recovery update
    dbService.pool.query
      .mockResolvedValueOnce([]) // recovery run update
      .mockResolvedValueOnce([]); // recovery agent update

    await service.handleQueue();

    const logged = JSON.stringify(errorSpy.mock.calls);
    errorSpy.mockRestore();

    // Safe metadata is logged (type + code), the raw message is not.
    expect(logged).toContain('code=PROTOCOL_CONNECTION_LOST');
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('DB connection lost');

    // 1 limit check, 2 failed result update, 3-4 recovery (run + agent)
    expect(dbService.pool.query).toHaveBeenCalledTimes(4);

    const recoveryRunSql = String(dbService.pool.query.mock.calls[2]?.[0]);
    const recoveryAgentSql = String(dbService.pool.query.mock.calls[3]?.[0]);

    expect(recoveryRunSql).toContain("status = 'failed'");
    expect(recoveryRunSql).toContain("status = 'running'");
    expect(recoveryAgentSql).toContain("status = 'idle'");
    expect(recoveryAgentSql).toContain("NOT IN ('paused', 'retired')");
  });

  it('should prevent overlapping ticks using isProcessing flag', async () => {
    dbService.pool.query.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve([[{ count: 0 }]]), 100),
        ),
    );

    const p1 = service.handleQueue();
    const p2 = service.handleQueue();
    await Promise.all([p1, p2]);

    expect(dbService.pool.getConnection).toHaveBeenCalledTimes(1);
  });
});
