import { OverviewService } from './overview.service.js';

const totalsRow = {
  agents: 5,
  agentsRunning: 2,
  projects: 3,
  experiments: 10,
  runs: 30,
  runsRunning: 1,
  runsQueued: 0,
  runsSucceeded: 23,
  runsFailed: 6,
};

function createService(results: unknown[][]) {
  const query = vi.fn();

  for (const rows of results) {
    query.mockResolvedValueOnce([rows, []]);
  }

  const service = new OverviewService({ pool: { query } } as never);

  return { service, query };
}

describe('OverviewService', () => {
  it('maps database rows to the response contract', async () => {
    const { service } = createService([
      [totalsRow],
      [
        {
          id: '1',
          name: 'Agent A',
          model: null,
          status: 'running',
          description: null,
          runs: '12',
          succeeded: '10',
          failed: '2',
          avgScore: '0.912500',
        },
      ],
      [
        {
          id: '7',
          status: 'succeeded',
          experiment: 'Exp 1',
          agent: null,
          accuracy: '0.930000',
          createdAt: new Date('2026-10-23T10:00:00.000Z'),
        },
      ],
      [
        {
          id: '9',
          level: 'warn',
          message: 'slow',
          agent: 'Agent A',
          createdAt: '2026-10-23T11:00:00.000Z',
        },
      ],
      [{ benchmark: 'MMLU', score: '0.8', n: '4' }],
    ]);

    const result = await service.getOverview();

    expect(result).toEqual({
      status: 'ok',
      source: 'mysql',
      totals: totalsRow,
      agents: [
        {
          id: 1,
          name: 'Agent A',
          model: null,
          status: 'running',
          description: null,
          runs: 12,
          succeeded: 10,
          failed: 2,
          avgScore: 0.9125,
        },
      ],
      runs: [
        {
          id: 7,
          status: 'succeeded',
          experiment: 'Exp 1',
          agent: null,
          accuracy: 0.93,
          createdAt: '2026-10-23T10:00:00.000Z',
        },
      ],
      logs: [
        {
          id: 9,
          level: 'warn',
          message: 'slow',
          agent: 'Agent A',
          createdAt: '2026-10-23T11:00:00.000Z',
        },
      ],
      benchmarks: [{ benchmark: 'MMLU', score: 0.8, n: 4 }],
    });
  });

  it('coerces numeric strings in totals to numbers', async () => {
    const stringTotals = Object.fromEntries(
      Object.entries(totalsRow).map(([key, value]) => [key, String(value)]),
    );
    const { service } = createService([[stringTotals], [], [], [], []]);

    const { totals } = await service.getOverview();

    expect(totals).toEqual(totalsRow);
    expect(Object.values(totals).every((v) => typeof v === 'number')).toBe(
      true,
    );
  });

  it('keeps run totals consistent with the status breakdown', async () => {
    const { service } = createService([[totalsRow], [], [], [], []]);

    const { totals } = await service.getOverview();

    expect(
      totals.runsRunning +
        totals.runsQueued +
        totals.runsSucceeded +
        totals.runsFailed,
    ).toBe(totals.runs);
  });

  it('returns empty lists when there is no data', async () => {
    const zero = Object.fromEntries(
      Object.keys(totalsRow).map((key) => [key, 0]),
    );
    const { service } = createService([[zero], [], [], [], []]);

    const result = await service.getOverview();

    expect(result.agents).toEqual([]);
    expect(result.runs).toEqual([]);
    expect(result.logs).toEqual([]);
    expect(result.benchmarks).toEqual([]);
    expect(result.totals.runs).toBe(0);
  });

  it('counts only non-retired agents and filters run statuses', async () => {
    const { service, query } = createService([[totalsRow], [], [], [], []]);

    await service.getOverview();

    expect(query).toHaveBeenCalledTimes(5);

    const totalsSql = String(query.mock.calls[0]?.[0]);

    expect(totalsSql).toContain("status <> 'retired'");
    expect(totalsSql).toContain("status = 'running'");
    expect(totalsSql).toContain("status = 'queued'");
    expect(totalsSql).toContain("status = 'succeeded'");
    expect(totalsSql).toContain("status = 'failed'");
  });

  it('limits recent runs, logs and benchmarks', async () => {
    const { service, query } = createService([[totalsRow], [], [], [], []]);

    await service.getOverview();

    expect(String(query.mock.calls[2]?.[0])).toContain('LIMIT 8');
    expect(String(query.mock.calls[3]?.[0])).toContain('LIMIT 12');
    expect(String(query.mock.calls[4]?.[0])).toContain('LIMIT 5');
  });

  it('fails when the totals query returns no row', async () => {
    const { service } = createService([[]]);

    await expect(service.getOverview()).rejects.toThrow(
      'Could not retrieve dashboard totals.',
    );
  });

  it('fails when the database returns an invalid timestamp', async () => {
    const { service } = createService([
      [totalsRow],
      [],
      [
        {
          id: 1,
          status: 'queued',
          experiment: 'Exp',
          agent: 'A',
          accuracy: null,
          createdAt: 'not-a-date',
        },
      ],
      [],
      [],
    ]);

    await expect(service.getOverview()).rejects.toThrow(
      'Database returned an invalid timestamp.',
    );
  });

  it('propagates database errors instead of returning partial data', async () => {
    const query = vi.fn().mockRejectedValue(new Error('connection lost'));
    const service = new OverviewService({ pool: { query } } as never);

    await expect(service.getOverview()).rejects.toThrow('connection lost');
  });
});
