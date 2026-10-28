import { OverviewController } from './overview.controller.js';
import type { OverviewResponse } from './dto/overview-response.dto.js';

describe('OverviewController', () => {
  it('returns what OverviewService produces', async () => {
    const expected: OverviewResponse = {
      status: 'ok',
      source: 'mysql',
      totals: {
        agents: 0,
        agentsRunning: 0,
        projects: 0,
        experiments: 0,
        runs: 0,
        runsRunning: 0,
        runsQueued: 0,
        runsSucceeded: 0,
        runsFailed: 0,
      },
      agents: [],
      runs: [],
      logs: [],
      benchmarks: [],
    };
    const getOverview = vi.fn().mockResolvedValue(expected);
    const controller = new OverviewController({ getOverview } as never);

    await expect(controller.getOverview()).resolves.toBe(expected);
    expect(getOverview).toHaveBeenCalledTimes(1);
  });

  it('is mounted at /api/overview', () => {
    expect(Reflect.getMetadata('path', OverviewController)).toBe(
      'api/overview',
    );
  });
});
