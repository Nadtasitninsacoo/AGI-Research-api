
export interface OverviewTotals {
  agents: number;
  agentsRunning: number;
  projects: number;
  experiments: number;
  runs: number;
  runsRunning: number;
  runsQueued: number;
  runsSucceeded: number;
  runsFailed: number;
}

export type AgentStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'error'
  | 'retired';

export interface OverviewAgent {
  id: number;
  name: string;
  model: string | null;
  status: AgentStatus;
  description: string | null;
  runs: number;
  succeeded: number;
  failed: number;
  avgScore: number | null;
}

export interface OverviewRun {
  id: number;
  status: string;
  experiment: string;
  agent: string | null;
  accuracy: number | null;
  createdAt: string;
}

export interface OverviewLog {
  id: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  agent: string;
  createdAt: string;
}

export interface OverviewBenchmark {
  benchmark: string;
  score: number;
  n: number;
}

export interface OverviewResponse {
  status: 'ok';
  source: 'mysql';
  totals: OverviewTotals;
  agents: OverviewAgent[];
  runs: OverviewRun[];
  logs: OverviewLog[];
  benchmarks: OverviewBenchmark[];
}