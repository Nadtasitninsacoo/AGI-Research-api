import { ApiTokenGuard } from '../../common/auth/api-token.guard.js';
import { ResearchApiController } from './research-api.controller.js';

const GUARDS_KEY = '__guards__';

function guardsOf(method: keyof ResearchApiController): unknown[] {
  const handler = ResearchApiController.prototype[method] as unknown;

  return (Reflect.getMetadata(GUARDS_KEY, handler as object) ??
    []) as unknown[];
}

describe('ResearchApiController access control', () => {
  it.each([
    'createAgent',
    'createExperiment',
    'createRun',
    'cancelRun',
  ] as const)('protects write endpoint %s with ApiTokenGuard', (method) => {
    expect(guardsOf(method)).toContain(ApiTokenGuard);
  });

  it.each([
    'getAgents',
    'getAgent',
    'getProjects',
    'getExperiments',
    'getRuns',
    'getRun',
    'getRunLogs',
    'getRunEvaluations',
  ] as const)('leaves read endpoint %s open', (method) => {
    expect(guardsOf(method)).toEqual([]);
  });

  it('does not put a guard on the whole controller', () => {
    expect(
      Reflect.getMetadata(GUARDS_KEY, ResearchApiController) ?? [],
    ).toEqual([]);
  });

  it('delegates cancelRun to the service', async () => {
    const cancelRun = vi.fn().mockResolvedValue({ id: 1, status: 'cancelled' });
    const controller = new ResearchApiController({ cancelRun } as never);

    await expect(controller.cancelRun('1')).resolves.toEqual({
      id: 1,
      status: 'cancelled',
    });
    expect(cancelRun).toHaveBeenCalledWith('1');
  });
});
