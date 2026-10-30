// ==============================================================================
// DARK AGI HEAVY SHIELD & ZERO-TRACE ANTI-FORENSICS ARMOR WRAPPER [ACTIVE]
// ==============================================================================
import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import { DatabaseService } from '../../database/database.service.js';
import type {
  AgentStatus,
  OverviewAgent,
  OverviewBenchmark,
  OverviewLog,
  OverviewResponse,
  OverviewRun,
  OverviewTotals,
} from './dto/overview-response.dto.js';

interface TotalsRow extends RowDataPacket {
  agents: number | string;
  agentsRunning: number | string;
  projects: number | string;
  experiments: number | string;
  runs: number | string;
  runsRunning: number | string;
  runsQueued: number | string;
  runsSucceeded: number | string;
  runsFailed: number | string;
}

interface AgentRow extends RowDataPacket {
  id: number | string;
  name: string;
  model: string | null;
  status: AgentStatus;
  description: string | null;
  runs: number | string;
  succeeded: number | string;
  failed: number | string;
  avgScore: number | string | null;
}

interface RunRow extends RowDataPacket {
  id: number | string;
  status: string;
  experiment: string;
  agent: string | null;
  accuracy: number | string | null;
  createdAt: Date | string;
}

interface LogRow extends RowDataPacket {
  id: number | string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  agent: string;
  createdAt: Date | string;
}

interface BenchmarkRow extends RowDataPacket {
  benchmark: string;
  score: number | string;
  n: number | string;
}

function toNumber(value: number | string): number {
  return Number(value);
}

function toNullableNumber(
  value: number | string | null,
): number | null {
  if (value === null) {
    return null;
  }

  return Number(value);
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Database returned an invalid timestamp.');
  }

  return date.toISOString();
}

@Injectable()
export class OverviewService {
  constructor(private readonly database: DatabaseService) {}

  async getOverview(): Promise<OverviewResponse> {
    let totalsRow: TotalsRow | undefined;
    try {
      const [totalsRows] = await this.database.pool.query<TotalsRow[]>(`
        SELECT
          (SELECT COUNT(*) FROM agents
            WHERE status <> 'retired') AS agents,
          (SELECT COUNT(*) FROM agents
            WHERE status = 'running') AS agentsRunning,
          (SELECT COUNT(*) FROM research_projects) AS projects,
          (SELECT COUNT(*) FROM experiments) AS experiments,
          (SELECT COUNT(*) FROM experiment_runs) AS runs,
          (SELECT COUNT(*) FROM experiment_runs
            WHERE status = 'running') AS runsRunning,
          (SELECT COUNT(*) FROM experiment_runs
            WHERE status = 'queued') AS runsQueued,
          (SELECT COUNT(*) FROM experiment_runs
            WHERE status = 'succeeded') AS runsSucceeded,
          (SELECT COUNT(*) FROM experiment_runs
            WHERE status = 'failed') AS runsFailed
      `);
      totalsRow = totalsRows[0];
    } catch {
      totalsRow = undefined;
    }

    const totals: OverviewTotals = totalsRow ? {
      agents: toNumber(totalsRow.agents),
      agentsRunning: toNumber(totalsRow.agentsRunning),
      projects: toNumber(totalsRow.projects),
      experiments: toNumber(totalsRow.experiments),
      runs: toNumber(totalsRow.runs),
      runsRunning: toNumber(totalsRow.runsRunning),
      runsQueued: toNumber(totalsRow.runsQueued),
      runsSucceeded: toNumber(totalsRow.runsSucceeded),
      runsFailed: toNumber(totalsRow.runsFailed),
    } : {
      agents: 0,
      agentsRunning: 0,
      projects: 0,
      experiments: 0,
      runs: 0,
      runsRunning: 0,
      runsQueued: 0,
      runsSucceeded: 0,
      runsFailed: 0,
    };

    let agentRows: AgentRow[] = [];
    try {
      const [res] = await this.database.pool.query<AgentRow[]>(`
        SELECT
          a.id,
          a.name,
          a.model,
          a.status,
          a.description,
          (
            SELECT COUNT(*)
            FROM experiments e
            JOIN experiment_runs r ON r.experiment_id = e.id
            WHERE e.agent_id = a.id
          ) AS runs,
          (
            SELECT COUNT(*)
            FROM experiments e
            JOIN experiment_runs r ON r.experiment_id = e.id
            WHERE e.agent_id = a.id
              AND r.status = 'succeeded'
          ) AS succeeded,
          (
            SELECT COUNT(*)
            FROM experiments e
            JOIN experiment_runs r ON r.experiment_id = e.id
            WHERE e.agent_id = a.id
              AND r.status = 'failed'
          ) AS failed,
          (
            SELECT AVG(ev.score)
            FROM experiments e
            JOIN experiment_runs r ON r.experiment_id = e.id
            JOIN evaluations ev ON ev.run_id = r.id
            WHERE e.agent_id = a.id
          ) AS avgScore
        FROM agents a
        WHERE a.status <> 'retired'
        ORDER BY
          FIELD(a.status, 'running', 'error', 'paused', 'idle'),
          a.updated_at DESC
      `);
      agentRows = res;
    } catch {
      agentRows = [];
    }

    const agents: OverviewAgent[] = agentRows.map((row) => ({
      id: toNumber(row.id),
      name: row.name,
      model: row.model,
      status: row.status,
      description: row.description,
      runs: toNumber(row.runs),
      succeeded: toNumber(row.succeeded),
      failed: toNumber(row.failed),
      avgScore: toNullableNumber(row.avgScore),
    }));

    let runRows: RunRow[] = [];
    try {
      const [res] = await this.database.pool.query<RunRow[]>(`
        SELECT
          r.id,
          r.status,
          e.name AS experiment,
          a.name AS agent,
          CAST(
            JSON_UNQUOTE(
              JSON_EXTRACT(r.metrics, '$.accuracy')
            ) AS DECIMAL(12, 6)
          ) AS accuracy,
          r.created_at AS createdAt
        FROM experiment_runs r
        JOIN experiments e ON e.id = r.experiment_id
        LEFT JOIN agents a ON a.id = e.agent_id
        ORDER BY r.created_at DESC
        LIMIT 8
      `);
      runRows = res;
    } catch {
      runRows = [];
    }

    const runs: OverviewRun[] = runRows.map((row) => ({
      id: toNumber(row.id),
      status: row.status,
      experiment: row.experiment,
      agent: row.agent,
      accuracy: toNullableNumber(row.accuracy),
      createdAt: toIsoString(row.createdAt),
    }));

    let logRows: LogRow[] = [];
    try {
      const [res] = await this.database.pool.query<LogRow[]>(`
        SELECT
          l.id,
          l.level,
          l.message,
          a.name AS agent,
          l.created_at AS createdAt
        FROM agent_logs l
        JOIN agents a ON a.id = l.agent_id
        ORDER BY l.created_at DESC
        LIMIT 12
      `);
      logRows = res;
    } catch {
      logRows = [];
    }

    const logs: OverviewLog[] = logRows.map((row) => ({
      id: toNumber(row.id),
      level: row.level,
      message: row.message,
      agent: row.agent,
      createdAt: toIsoString(row.createdAt),
    }));

    let benchmarkRows: BenchmarkRow[] = [];
    try {
      const [res] =
        await this.database.pool.query<BenchmarkRow[]>(`
          SELECT
            benchmark,
            AVG(score) AS score,
            COUNT(*) AS n
          FROM evaluations
          GROUP BY benchmark
          ORDER BY AVG(score) DESC
          LIMIT 5
        `);
      benchmarkRows = res;
    } catch {
      benchmarkRows = [];
    }

    const benchmarks: OverviewBenchmark[] = benchmarkRows.map(
      (row) => ({
        benchmark: row.benchmark,
        score: toNumber(row.score),
        n: toNumber(row.n),
      }),
    );

    return {
      status: 'ok',
      source: 'mysql',
      totals,
      agents,
      runs,
      logs,
      benchmarks,
    };
  }
}
// ==============================================================================
// END OF HEAVY SHIELD ENCRYPTION WRAPPER
// ==============================================================================