import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ResearchApiService } from './research-api.service.js';

type Mock = ReturnType<typeof vi.fn>;

const MASKED_ERROR = 'Run failed. Check server logs for details.';
const CREATED = new Date('2026-10-22T09:09:46.000Z');
const UPDATED = new Date('2026-10-22T10:00:00.000Z');

function setup() {
  const query = vi.fn();
  const execute = vi.fn();
  const service = new ResearchApiService({ pool: { query, execute } } as never);

  return { service, query, execute };
}

// mysql2 resolves to [rows | ResultSetHeader, fields]
function reply(fn: Mock, data: unknown) {
  fn.mockResolvedValueOnce([data, []]);
}

const agentRow = {
  id: '1',
  name: 'ORACLE-7',
  description: null,
  model: 'claude-fable-5-1',
  config: { temperature: 0.2 },
  status: 'running',
  runs: '6',
  succeeded: '5',
  failed: '1',
  avgScore: '0.7464',
  created_at: CREATED,
};

const experimentRow = {
  id: '4',
  project_id: '2',
  agent_id: null,
  name: 'EXP-004',
  hypothesis: null,
  status: 'planned',
  created_at: CREATED,
};

const runRow = {
  id: '9',
  experiment_id: '4',
  status: 'failed',
  metrics: null,
  error_message: 'ECONNREFUSED 10.0.0.5 secret-token',
  created_at: CREATED,
  started_at: CREATED,
  finished_at: null,
};

const invalidIds = ['abc', '0', '-1', '1e3', '1.5', ' 1', '1 OR 1=1', ''];

describe('ResearchApiService', () => {
  describe('createAgent', () => {
    it('inserts a trimmed, parameterized agent and returns it', async () => {
      const { service, execute } = setup();
      reply(execute, { insertId: 1, affectedRows: 1 });
      reply(execute, [agentRow]);

      const agent = await service.createAgent({
        name: '  ORACLE-7  ',
        description: 'planner',
        model: 'claude-fable-5-1',
        config: { temperature: 0.2 },
      });

      const [sql, values] = execute.mock.calls[0] as [string, unknown[]];

      expect(sql).toContain('INSERT INTO agents');
      expect(sql).not.toContain('ORACLE-7');
      expect(values).toEqual([
        'ORACLE-7',
        'planner',
        'claude-fable-5-1',
        JSON.stringify({ temperature: 0.2 }),
      ]);
      expect(agent).toEqual({
        id: 1,
        name: 'ORACLE-7',
        description: null,
        model: 'claude-fable-5-1',
        config: { temperature: 0.2 },
        status: 'running',
        runs: 6,
        succeeded: 5,
        failed: 1,
        avgScore: 0.7464,
        createdAt: '2026-10-22T09:09:46.000Z',
      });
    });

    it('stores null for omitted optional fields', async () => {
      const { service, execute } = setup();
      reply(execute, { insertId: 1, affectedRows: 1 });
      reply(execute, [agentRow]);

      await service.createAgent({ name: 'A' });

      expect(execute.mock.calls[0]?.[1]).toEqual(['A', null, null, null]);
    });

    it.each([
      ['undefined body', undefined],
      ['null body', null],
      ['array body', [1]],
      ['string body', 'x'],
      ['missing name', {}],
      ['empty name', { name: '' }],
      ['whitespace name', { name: '   ' }],
      ['numeric name', { name: 5 }],
      ['name over 120 chars', { name: 'a'.repeat(121) }],
      ['non-string description', { name: 'A', description: 5 }],
      [
        'description over 5000 chars',
        { name: 'A', description: 'x'.repeat(5001) },
      ],
      ['model over 120 chars', { name: 'A', model: 'm'.repeat(121) }],
      ['array config', { name: 'A', config: [1] }],
      ['string config', { name: 'A', config: 'x' }],
      ['null config', { name: 'A', config: null }],
      ['config over 16KB', { name: 'A', config: { a: 'x'.repeat(17000) } }],
    ])(
      'rejects %s with 400 and never touches the database',
      async (_n, body) => {
        const { service, execute, query } = setup();

        await expect(service.createAgent(body)).rejects.toThrow(
          BadRequestException,
        );
        expect(execute).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
      },
    );

    it('maps a duplicate-entry error to 409', async () => {
      const { service, execute } = setup();
      execute.mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' });

      await expect(service.createAgent({ name: 'A' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows unexpected database errors unchanged', async () => {
      const { service, execute } = setup();
      execute.mockRejectedValueOnce(new Error('boom'));

      await expect(service.createAgent({ name: 'A' })).rejects.toThrow('boom');
    });
  });

  describe('getAgents / getAgent', () => {
    it('maps rows: numeric strings to numbers, null score kept', async () => {
      const { service, query } = setup();
      reply(query, [agentRow, { ...agentRow, id: '2', avgScore: null }]);

      const agents = await service.getAgents();

      expect(agents).toHaveLength(2);
      expect(agents[0]).toMatchObject({ id: 1, runs: 6, avgScore: 0.7464 });
      expect(agents[1]).toMatchObject({ id: 2, avgScore: null });
      expect(agents[0]?.createdAt).toBe('2026-10-22T09:09:46.000Z');
    });

    it('returns an empty list when there are no agents', async () => {
      const { service, query } = setup();
      reply(query, []);

      await expect(service.getAgents()).resolves.toEqual([]);
    });

    it('returns one agent by id using a placeholder', async () => {
      const { service, execute } = setup();
      reply(execute, [agentRow]);

      const agent = await service.getAgent('1');

      expect(agent.id).toBe(1);
      expect(execute.mock.calls[0]?.[1]).toEqual([1]);
    });

    it('404s when the agent does not exist', async () => {
      const { service, execute } = setup();
      reply(execute, []);

      await expect(service.getAgent('99')).rejects.toThrow(NotFoundException);
    });

    it.each(invalidIds)(
      'rejects id %j with 400 before querying',
      async (id) => {
        const { service, execute } = setup();

        await expect(service.getAgent(id)).rejects.toThrow(BadRequestException);
        expect(execute).not.toHaveBeenCalled();
      },
    );
  });

  describe('createExperiment', () => {
    it('creates an experiment without an agent (3 queries, no agent check)', async () => {
      const { service, execute } = setup();
      reply(execute, [{ id: 2 }]); // project exists
      reply(execute, { insertId: 4, affectedRows: 1 });
      reply(execute, [experimentRow]);

      const experiment = await service.createExperiment({
        projectId: 2,
        name: ' EXP-004 ',
      });

      expect(execute).toHaveBeenCalledTimes(3);
      expect(execute.mock.calls[1]?.[1]).toEqual([2, null, 'EXP-004', null]);
      expect(experiment).toEqual({
        id: 4,
        projectId: 2,
        agentId: null,
        name: 'EXP-004',
        hypothesis: null,
        status: 'planned',
        createdAt: '2026-10-22T09:09:46.000Z',
      });
    });

    it('checks the agent when agentId is given', async () => {
      const { service, execute } = setup();
      reply(execute, [{ id: 2 }]); // project
      reply(execute, [{ id: 1 }]); // agent
      reply(execute, { insertId: 4, affectedRows: 1 });
      reply(execute, [{ ...experimentRow, agent_id: '1' }]);

      const experiment = await service.createExperiment({
        projectId: 2,
        agentId: 1,
        name: 'E',
      });

      expect(execute).toHaveBeenCalledTimes(4);
      expect(experiment?.agentId).toBe(1);
    });

    it('404s and inserts nothing when the project is missing', async () => {
      const { service, execute } = setup();
      reply(execute, []);

      await expect(
        service.createExperiment({ projectId: 999, name: 'E' }),
      ).rejects.toThrow(NotFoundException);
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('404s and inserts nothing when the agent is missing', async () => {
      const { service, execute } = setup();
      reply(execute, [{ id: 2 }]);
      reply(execute, []);

      await expect(
        service.createExperiment({ projectId: 2, agentId: 999, name: 'E' }),
      ).rejects.toThrow(NotFoundException);
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['projectId missing', { name: 'E' }],
      ['projectId string', { projectId: '2', name: 'E' }],
      ['projectId 0', { projectId: 0, name: 'E' }],
      ['projectId float', { projectId: 1.5, name: 'E' }],
      ['projectId negative', { projectId: -1, name: 'E' }],
      ['agentId string', { projectId: 2, agentId: '1', name: 'E' }],
      ['agentId 0', { projectId: 2, agentId: 0, name: 'E' }],
      ['name missing', { projectId: 2 }],
      ['name too long', { projectId: 2, name: 'n'.repeat(121) }],
      ['hypothesis not a string', { projectId: 2, name: 'E', hypothesis: 5 }],
      ['array body', []],
    ])('rejects %s with 400 and no database access', async (_n, body) => {
      const { service, execute } = setup();

      await expect(service.createExperiment(body)).rejects.toThrow(
        BadRequestException,
      );
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('createRun', () => {
    it('queues a run with serialized params', async () => {
      const { service, execute } = setup();
      reply(execute, [{ id: 4 }]);
      reply(execute, { insertId: 9, affectedRows: 1 });
      reply(execute, [{ ...runRow, status: 'queued', error_message: null }]);

      const run = await service.createRun('4', { params: { prompt: 'hi' } });

      const [sql, values] = execute.mock.calls[1] as [string, unknown[]];

      expect(sql).toContain("'queued'");
      expect(values).toEqual([4, JSON.stringify({ prompt: 'hi' })]);
      expect(run).toMatchObject({
        id: 9,
        experimentId: 4,
        status: 'queued',
        errorMessage: null,
      });
    });

    it('stores null params when none are given', async () => {
      const { service, execute } = setup();
      reply(execute, [{ id: 4 }]);
      reply(execute, { insertId: 9, affectedRows: 1 });
      reply(execute, [{ ...runRow, status: 'queued', error_message: null }]);

      await service.createRun('4', {});

      expect(execute.mock.calls[1]?.[1]).toEqual([4, null]);
    });

    it('404s when the experiment does not exist', async () => {
      const { service, execute } = setup();
      reply(execute, []);

      await expect(service.createRun('999', {})).rejects.toThrow(
        NotFoundException,
      );
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it.each(invalidIds)('rejects experiment id %j with 400', async (id) => {
      const { service, execute } = setup();

      await expect(service.createRun(id, {})).rejects.toThrow(
        BadRequestException,
      );
      expect(execute).not.toHaveBeenCalled();
    });

    it.each([
      ['params number', { params: 5 }],
      ['params array', { params: [1] }],
      ['params string', { params: 'x' }],
      ['params over 16KB', { params: { a: 'x'.repeat(17000) } }],
      ['array body', []],
    ])('rejects %s with 400', async (_n, body) => {
      const { service, execute } = setup();

      await expect(service.createRun('4', body)).rejects.toThrow(
        BadRequestException,
      );
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('getRun', () => {
    it('masks the raw database error text and maps timestamps', async () => {
      const { service, execute } = setup();
      reply(execute, [runRow]);

      const run = await service.getRun('9');

      expect(run.errorMessage).toBe(MASKED_ERROR);
      expect(JSON.stringify(run)).not.toContain('secret-token');
      expect(run.startedAt).toBe('2026-10-22T09:09:46.000Z');
      expect(run.finishedAt).toBeNull();
      expect(run.createdAt).toBe('2026-10-22T09:09:46.000Z');
    });

    it('keeps errorMessage null when the run has no error', async () => {
      const { service, execute } = setup();
      reply(execute, [{ ...runRow, error_message: null }]);

      await expect(service.getRun('9')).resolves.toMatchObject({
        errorMessage: null,
      });
    });

    it('404s for a missing run', async () => {
      const { service, execute } = setup();
      reply(execute, []);

      await expect(service.getRun('999')).rejects.toThrow(NotFoundException);
    });

    it.each(invalidIds)('rejects id %j with 400', async (id) => {
      const { service, execute } = setup();

      await expect(service.getRun(id)).rejects.toThrow(BadRequestException);
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('getProjects', () => {
    const projectRow = {
      id: '1',
      title: 'Alpha',
      summary: null,
      status: 'active',
      ownerId: null,
      createdAt: CREATED,
      updatedAt: UPDATED,
    };

    it('uses default pagination and returns the envelope', async () => {
      const { service, query } = setup();
      reply(query, [{ total: '3' }]);
      reply(query, [projectRow]);

      const result = await service.getProjects(undefined);

      expect(query.mock.calls[1]?.[1]).toEqual([20, 0]);
      expect(result).toEqual({
        data: [
          {
            id: 1,
            title: 'Alpha',
            summary: null,
            status: 'active',
            ownerId: null,
            createdAt: '2026-10-22T09:09:46.000Z',
            updatedAt: '2026-10-22T10:00:00.000Z',
          },
        ],
        pagination: { limit: 20, offset: 0, total: 3 },
      });
    });

    it('passes validated limit and offset as parameters', async () => {
      const { service, query } = setup();
      reply(query, [{ total: 3 }]);
      reply(query, []);

      const result = await service.getProjects({ limit: '2', offset: '1' });

      expect(query.mock.calls[1]?.[1]).toEqual([2, 1]);
      expect(result.pagination).toEqual({ limit: 2, offset: 1, total: 3 });
    });

    it('accepts the maximum limit of 100', async () => {
      const { service, query } = setup();
      reply(query, [{ total: 0 }]);
      reply(query, []);

      await expect(
        service.getProjects({ limit: '100' }),
      ).resolves.toMatchObject({ pagination: { limit: 100 } });
    });

    it.each([
      ['limit 0', { limit: '0' }],
      ['limit 101', { limit: '101' }],
      ['limit negative', { limit: '-1' }],
      ['limit text', { limit: 'abc' }],
      ['limit decimal', { limit: '1.5' }],
      ['limit exponent', { limit: '1e2' }],
      ['limit empty', { limit: '' }],
      ['limit repeated', { limit: ['1', '2'] }],
      ['limit injection', { limit: '1; DROP TABLE agents' }],
      ['offset negative', { offset: '-1' }],
      ['offset text', { offset: 'x' }],
      ['non-object query', 'limit=1'],
    ])('rejects %s with 400 before querying', async (_n, q) => {
      const { service, query } = setup();

      await expect(service.getProjects(q)).rejects.toThrow(BadRequestException);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('getExperiments', () => {
    const listRow = {
      id: '4',
      projectId: '2',
      agentId: null,
      datasetId: null,
      name: 'EXP-004',
      hypothesis: null,
      status: 'planned',
      agentName: null,
      runCount: '3',
      createdAt: CREATED,
      updatedAt: UPDATED,
    };

    it('lists without a filter and maps counts and nullable fields', async () => {
      const { service, query } = setup();
      reply(query, [{ total: 10 }]);
      reply(query, [listRow]);

      const result = await service.getExperiments({});

      expect(String(query.mock.calls[0]?.[0])).not.toContain('WHERE');
      expect(query.mock.calls[1]?.[1]).toEqual([20, 0]);
      expect(result.data[0]).toEqual({
        id: 4,
        projectId: 2,
        agentId: null,
        datasetId: null,
        name: 'EXP-004',
        hypothesis: null,
        status: 'planned',
        agentName: null,
        runCount: 3,
        createdAt: '2026-10-22T09:09:46.000Z',
        updatedAt: '2026-10-22T10:00:00.000Z',
      });
      expect(result.pagination.total).toBe(10);
    });

    it('applies the projectId filter to both count and rows', async () => {
      const { service, query } = setup();
      reply(query, [{ total: 4 }]);
      reply(query, []);

      await service.getExperiments({ projectId: '3', limit: '5' });

      const [countSql, countValues] = query.mock.calls[0] as [
        string,
        unknown[],
      ];
      const [rowSql, rowValues] = query.mock.calls[1] as [string, unknown[]];

      expect(countSql).toContain('e.project_id = ?');
      expect(rowSql).toContain('e.project_id = ?');
      expect(countValues).toEqual([3]);
      expect(rowValues).toEqual([3, 5, 0]);
    });

    it.each(['0', 'abc', '-1', '1.5', '', '1 OR 1=1'])(
      'rejects projectId %j with 400',
      async (projectId) => {
        const { service, query } = setup();

        await expect(service.getExperiments({ projectId })).rejects.toThrow(
          BadRequestException,
        );
        expect(query).not.toHaveBeenCalled();
      },
    );
  });

  describe('getRuns', () => {
    const listRow = {
      id: '9',
      experimentId: '4',
      experimentName: 'EXP-004',
      agentName: null,
      status: 'failed',
      params: { prompt: 'hi' },
      metrics: { latencyMs: 12 },
      errorMessage: 'ECONNREFUSED secret-token',
      startedAt: CREATED,
      finishedAt: null,
      createdAt: CREATED,
    };

    it('maps rows, passes JSON through and masks error text', async () => {
      const { service, query } = setup();
      reply(query, [{ total: 1 }]);
      reply(query, [listRow]);

      const result = await service.getRuns({});

      expect(result.data[0]).toEqual({
        id: 9,
        experimentId: 4,
        experimentName: 'EXP-004',
        agentName: null,
        status: 'failed',
        params: { prompt: 'hi' },
        metrics: { latencyMs: 12 },
        errorMessage: MASKED_ERROR,
        createdAt: '2026-10-22T09:09:46.000Z',
        startedAt: '2026-10-22T09:09:46.000Z',
        finishedAt: null,
      });
      expect(JSON.stringify(result)).not.toContain('secret-token');
    });

    it('keeps errorMessage null when there is none', async () => {
      const { service, query } = setup();
      reply(query, [{ total: 1 }]);
      reply(query, [{ ...listRow, errorMessage: null }]);

      const result = await service.getRuns({});

      expect(result.data[0]?.errorMessage).toBeNull();
    });

    it('uses identical filters for the count and the rows', async () => {
      const { service, query } = setup();
      reply(query, [{ total: 3 }]);
      reply(query, []);

      await service.getRuns({
        status: 'succeeded',
        experimentId: '5',
        limit: '10',
        offset: '2',
      });

      const [countSql, countValues] = query.mock.calls[0] as [
        string,
        unknown[],
      ];
      const [rowSql, rowValues] = query.mock.calls[1] as [string, unknown[]];

      for (const sql of [countSql, rowSql]) {
        expect(sql).toContain('r.status = ?');
        expect(sql).toContain('r.experiment_id = ?');
        expect(sql).not.toContain('succeeded');
      }
      expect(countValues).toEqual(['succeeded', 5]);
      expect(rowValues).toEqual(['succeeded', 5, 10, 2]);
    });

    it.each(['queued', 'running', 'succeeded', 'failed', 'cancelled'])(
      'accepts status %s',
      async (status) => {
        const { service, query } = setup();
        reply(query, [{ total: 0 }]);
        reply(query, []);

        await expect(service.getRuns({ status })).resolves.toBeDefined();
      },
    );

    it.each([
      'bogus',
      'SUCCEEDED',
      '',
      "succeeded' OR '1'='1",
      'queued,running',
    ])('rejects status %j with 400', async (status) => {
      const { service, query } = setup();

      await expect(service.getRuns({ status })).rejects.toThrow(
        BadRequestException,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it.each(['0', 'abc', '-1', '1e3'])(
      'rejects experimentId %j with 400',
      async (experimentId) => {
        const { service, query } = setup();

        await expect(service.getRuns({ experimentId })).rejects.toThrow(
          BadRequestException,
        );
        expect(query).not.toHaveBeenCalled();
      },
    );
  });

  describe('getRunLogs', () => {
    const logRow = {
      id: '3',
      agentId: '1',
      runId: '9',
      level: 'error',
      message: 'run failed',
      context: { code: 7 },
      createdAt: CREATED,
    };

    it('returns the logs of an existing run', async () => {
      const { service, query } = setup();
      reply(query, [{ id: 9 }]); // run exists
      reply(query, [{ total: 1 }]);
      reply(query, [logRow]);

      const result = await service.getRunLogs('9', { limit: '5' });

      expect(query.mock.calls[2]?.[1]).toEqual([9, 5, 0]);
      expect(result).toEqual({
        data: [
          {
            id: 3,
            agentId: 1,
            runId: 9,
            level: 'error',
            message: 'run failed',
            context: { code: 7 },
            createdAt: '2026-10-22T09:09:46.000Z',
          },
        ],
        pagination: { limit: 5, offset: 0, total: 1 },
      });
    });

    it('returns an empty page (not 404) for a run without logs', async () => {
      const { service, query } = setup();
      reply(query, [{ id: 9 }]);
      reply(query, [{ total: 0 }]);
      reply(query, []);

      await expect(service.getRunLogs('9', {})).resolves.toEqual({
        data: [],
        pagination: { limit: 20, offset: 0, total: 0 },
      });
    });

    it('404s for a missing run without running the list query', async () => {
      const { service, query } = setup();
      reply(query, []);

      await expect(service.getRunLogs('999', {})).rejects.toThrow(
        NotFoundException,
      );
      expect(query).toHaveBeenCalledTimes(1);
    });

    it.each(invalidIds)('rejects id %j with 400', async (id) => {
      const { service, query } = setup();

      await expect(service.getRunLogs(id, {})).rejects.toThrow(
        BadRequestException,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('validates pagination before checking the run', async () => {
      const { service, query } = setup();

      await expect(service.getRunLogs('9', { limit: '0' })).rejects.toThrow(
        BadRequestException,
      );
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('getRunEvaluations', () => {
    const evaluationRow = {
      id: '2',
      runId: '9',
      benchmark: 'MMLU-Pro',
      score: '0.75',
      details: { n: 3 },
      createdAt: CREATED,
    };

    it('returns the evaluations of an existing run', async () => {
      const { service, query } = setup();
      reply(query, [{ id: 9 }]);
      reply(query, [{ total: 1 }]);
      reply(query, [evaluationRow]);

      const result = await service.getRunEvaluations('9', {});

      expect(result.data).toEqual([
        {
          id: 2,
          runId: 9,
          benchmark: 'MMLU-Pro',
          score: 0.75,
          details: { n: 3 },
          createdAt: '2026-10-22T09:09:46.000Z',
        },
      ]);
      expect(result.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
    });

    it('returns an empty page for an existing run without evaluations', async () => {
      const { service, query } = setup();
      reply(query, [{ id: 9 }]);
      reply(query, [{ total: 0 }]);
      reply(query, []);

      const result = await service.getRunEvaluations('9', {});

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });

    it('404s for a missing run', async () => {
      const { service, query } = setup();
      reply(query, []);

      await expect(service.getRunEvaluations('999', {})).rejects.toThrow(
        NotFoundException,
      );
      expect(query).toHaveBeenCalledTimes(1);
    });

    it.each(invalidIds)('rejects id %j with 400', async (id) => {
      const { service, query } = setup();

      await expect(service.getRunEvaluations(id, {})).rejects.toThrow(
        BadRequestException,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects a negative offset with 400', async () => {
      const { service, query } = setup();

      await expect(
        service.getRunEvaluations('9', { offset: '-5' }),
      ).rejects.toThrow(BadRequestException);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('cancelRun', () => {
    it('cancels a queued run atomically and returns the updated run', async () => {
      const { service, query, execute } = setup();
      reply(query, { affectedRows: 1 });
      reply(execute, [{ ...runRow, status: 'cancelled', error_message: null }]);

      const run = await service.cancelRun('9');

      const [sql, values] = query.mock.calls[0] as [string, unknown[]];

      expect(sql).toContain("status = 'cancelled'");
      expect(sql).toContain("status = 'queued'");
      expect(values).toEqual([9]);
      expect(run.status).toBe('cancelled');
    });

    it('409s when the run exists but is not queued', async () => {
      const { service, query } = setup();
      reply(query, { affectedRows: 0 });
      reply(query, [{ id: 9 }]);

      await expect(service.cancelRun('9')).rejects.toThrow(ConflictException);
    });

    it('404s when the run does not exist', async () => {
      const { service, query } = setup();
      reply(query, { affectedRows: 0 });
      reply(query, []);

      await expect(service.cancelRun('999')).rejects.toThrow(NotFoundException);
    });

    it.each(invalidIds)(
      'rejects id %j with 400 before any write',
      async (id) => {
        const { service, query } = setup();

        await expect(service.cancelRun(id)).rejects.toThrow(
          BadRequestException,
        );
        expect(query).not.toHaveBeenCalled();
      },
    );

    it('does not leak the stored status in the conflict message', async () => {
      const { service, query } = setup();
      reply(query, { affectedRows: 0 });
      reply(query, [{ id: 9 }]);

      await expect(service.cancelRun('9')).rejects.toThrow(
        'Only queued runs can be cancelled',
      );
    });
  });
});
