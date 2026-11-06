import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { DatabaseService } from '../../database/database.service.js';

type AgentStatus = 'idle' | 'running' | 'paused' | 'error';
type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

type SqlValue = string | number;

interface InputObject {
  [key: string]: unknown;
}

interface AgentRow extends RowDataPacket {
  id: number | string;
  name: string;
  description: string | null;
  model: string | null;
  config: unknown;
  status: AgentStatus | 'retired';
  runs: number | string;
  succeeded: number | string;
  failed: number | string;
  avgScore: number | string | null;
  created_at: Date | string;
}

interface ExperimentRow extends RowDataPacket {
  id: number | string;
  project_id: number | string;
  agent_id: number | string | null;
  name: string;
  hypothesis: string | null;
  status: string;
  created_at: Date | string;
}

interface RunRow extends RowDataPacket {
  id: number | string;
  experiment_id: number | string;
  status: RunStatus;
  metrics: unknown;
  error_message: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

interface CountRow extends RowDataPacket {
  total: number | string;
}

interface ProjectRow extends RowDataPacket {
  id: number | string;
  title: string;
  summary: string | null;
  status: string;
  ownerId: number | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface ExperimentListRow extends RowDataPacket {
  id: number | string;
  projectId: number | string;
  agentId: number | string | null;
  datasetId: number | string | null;
  name: string;
  hypothesis: string | null;
  status: string;
  agentName: string | null;
  runCount: number | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface RunListRow extends RowDataPacket {
  id: number | string;
  experimentId: number | string;
  experimentName: string | null;
  agentName: string | null;
  status: RunStatus;
  params: unknown;
  metrics: unknown;
  errorMessage: string | null;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  createdAt: Date | string;
}

interface LogListRow extends RowDataPacket {
  id: number | string;
  agentId: number | string;
  runId: number | string | null;
  level: string;
  message: string;
  context: unknown;
  createdAt: Date | string;
}

interface EvaluationListRow extends RowDataPacket {
  id: number | string;
  runId: number | string;
  benchmark: string;
  score: number | string;
  details: unknown;
  createdAt: Date | string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MASKED_ERROR = 'Run failed. Check server logs for details.';

const RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

const AGENT_SELECT = `
  SELECT
    a.id,
    a.name,
    a.description,
    a.model,
    a.config,
    a.status,
    a.created_at,
    COUNT(DISTINCT r.id) AS runs,
    COUNT(DISTINCT CASE
      WHEN r.status = 'succeeded' THEN r.id
    END) AS succeeded,
    COUNT(DISTINCT CASE
      WHEN r.status = 'failed' THEN r.id
    END) AS failed,
    AVG(ev.avg_score) AS avgScore
  FROM agents a
  LEFT JOIN experiments e ON e.agent_id = a.id
  LEFT JOIN experiment_runs r ON r.experiment_id = e.id
  LEFT JOIN (
    SELECT run_id, AVG(score) AS avg_score
    FROM evaluations
    GROUP BY run_id
  ) ev ON ev.run_id = r.id
`;

function isObject(value: unknown): value is InputObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(value: unknown): InputObject {
  if (!isObject(value)) {
    throw new BadRequestException('Request body must be an object');
  }

  return value as InputObject;
}

function parseId(value: unknown): number {
  if (value === undefined || value === null) {
    throw new BadRequestException('ID is required');
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException('ID must be a positive integer');
    }
    return value;
  }

  if (typeof value !== 'string' || value.trim() === '' || value.trim() !== value) {
    throw new BadRequestException('ID must be a positive integer');
  }

  if (!/^[0-9]+$/.test(value)) {
    throw new BadRequestException('ID must be a positive integer');
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException('ID must be a positive integer');
  }

  return parsed;
}

function parsePositiveId(value: unknown, field: string): number {
  if (typeof value !== 'number') {
    throw new BadRequestException(`${field} must be a positive integer`);
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }

  return value;
}

function parseQueryPositiveId(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive integer`);
    }
    return value;
  }

  if (typeof value !== 'string' || value.trim() === '' || value.trim() !== value) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }

  if (!/^[0-9]+$/.test(value)) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }

  return parsed;
}

function parseString(
  value: unknown,
  field: string,
  maxLength: number,
  required: boolean,
): string {
  if (value === undefined || value === null) {
    if (required) {
      throw new BadRequestException(`${field} is required`);
    }
    return '';
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }

  const str = value.trim();
  if (str.length === 0) {
    if (required) {
      throw new BadRequestException(`${field} is required`);
    }
    return '';
  }

  if (str.length > maxLength) {
    throw new BadRequestException(`${field} exceeds ${maxLength} characters`);
  }

  return str;
}

function parseOptionalText(
  body: InputObject,
  field: string,
  maxLength: number,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(body, field)) {
    return null;
  }

  const value = body[field];
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new BadRequestException(`${field} exceeds ${maxLength} characters`);
  }

  return trimmed;
}

function parseJsonObject(value: unknown, field: string): InputObject {
  if (value === undefined || value === null) {
    throw new BadRequestException(`${field} is required`);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (isObject(parsed)) {
        const serialized = JSON.stringify(parsed);
        if (serialized.length > 16384) {
          throw new BadRequestException(`${field} exceeds 16KB`);
        }
        return parsed as InputObject;
      }
      throw new BadRequestException(`${field} must be a JSON object`);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`${field} must be valid JSON`);
    }
  }

  if (!isObject(value)) {
    throw new BadRequestException(`${field} must be an object`);
  }

  const serialized = JSON.stringify(value);
  if (serialized.length > 16384) {
    throw new BadRequestException(`${field} exceeds 16KB`);
  }

  return value as InputObject;
}

function parseIntegerQuery(
  value: unknown,
  field: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'string' && value.trim() === '') {
    throw new BadRequestException(
      `${field} must be an integer between ${min} and ${max}`,
    );
  }

  const text = typeof value === 'string' ? value : String(value);
  if (!/^[0-9]+$/.test(text)) {
    throw new BadRequestException(
      `${field} must be an integer between ${min} and ${max}`,
    );
  }

  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException(
      `${field} must be an integer between ${min} and ${max}`,
    );
  }

  return parsed;
}

function parsePagination(query: unknown): { limit: number; offset: number } {
  if (query !== undefined && query !== null && (typeof query !== 'object' || Array.isArray(query))) {
    throw new BadRequestException('Query must be an object');
  }

  const source = toQueryObject(query);
  const limit = parseIntegerQuery(
    source.limit,
    'limit',
    1,
    MAX_LIMIT,
    DEFAULT_LIMIT,
  );
  const offset = parseIntegerQuery(source.offset, 'offset', 0, 1000000, 0);
  return { limit, offset };
}

function parseOptionalIdQuery(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string' && value.trim() === '') {
    throw new BadRequestException(`${field} must be a positive integer`);
  }

  return parseQueryPositiveId(value, field);
}

function parseOptionalRunStatus(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException('Invalid run status');
  }

  const status = value.trim();
  if (!RUN_STATUSES.includes(status as (typeof RUN_STATUSES)[number])) {
    throw new BadRequestException(`Invalid run status: ${status}`);
  }

  return status;
}

function toQueryObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function toIso(value: Date | string | null): string {
  if (!value) {
    return new Date().toISOString();
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

function toNullableIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return toIso(value);
}

function toNumber(value: number | string | null): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function toNullableNumber(value: number | string | null): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function toWhere(conditions: string[]): string {
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

function toPage<T>(
  data: T[],
  pagination: { limit: number; offset: number },
  total: number,
) {
  return {
    data,
    pagination: {
      limit: pagination.limit,
      offset: pagination.offset,
      total,
    },
  };
}

@Injectable()
export class ResearchApiService {
  private readonly logger = new Logger(ResearchApiService.name);

  constructor(private readonly database: DatabaseService) {}

  async getProjects(queryValue: unknown) {
    const pagination = parsePagination(queryValue);

    let total = 0;
    try {
      total = await this.count(
        'SELECT COUNT(*) AS total FROM research_projects',
      );
    } catch {
      total = 0;
    }

    let rows: ProjectRow[] = [];
    try {
      const [res] = await this.database.pool.query<ProjectRow[]>(
        `SELECT id, title, summary, status,
                owner_id AS ownerId,
                created_at AS createdAt,
                updated_at AS updatedAt
         FROM research_projects
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [pagination.limit, pagination.offset],
      );
      rows = res;
    } catch {
      rows = [];
    }

    return toPage(
      rows.map((row) => ({
        id: toNumber(row.id),
        title: row.title,
        summary: row.summary,
        status: row.status,
        ownerId: toNullableNumber(row.ownerId),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
      pagination,
      total,
    );
  }

  async getExperiments(queryValue: unknown) {
    const query = toQueryObject(queryValue);
    const pagination = parsePagination(query);
    const projectId = parseOptionalIdQuery(query.projectId, 'projectId');

    const conditions: string[] = [];
    const values: SqlValue[] = [];

    if (projectId !== undefined) {
      conditions.push('e.project_id = ?');
      values.push(projectId);
    }

    const where = toWhere(conditions);

    let total = 0;
    try {
      total = await this.count(
        `SELECT COUNT(*) AS total FROM experiments e ${where}`,
        values,
      );
    } catch {
      total = 0;
    }

    let rows: ExperimentListRow[] = [];
    try {
      const [res] = await this.database.pool.query<ExperimentListRow[]>(
        `SELECT e.id,
                e.project_id AS projectId,
                e.agent_id AS agentId,
                e.dataset_id AS datasetId,
                e.name,
                e.hypothesis,
                e.status,
                a.name AS agentName,
                COALESCE(rc.run_count, 0) AS runCount,
                e.created_at AS createdAt,
                e.updated_at AS updatedAt
         FROM experiments e
         LEFT JOIN agents a ON a.id = e.agent_id
         LEFT JOIN (
           SELECT experiment_id, COUNT(*) AS run_count
           FROM experiment_runs
           GROUP BY experiment_id
         ) rc ON rc.experiment_id = e.id
         ${where}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT ? OFFSET ?`,
        [...values, pagination.limit, pagination.offset],
      );
      rows = res;
    } catch {
      rows = [];
    }

    return toPage(
      rows.map((row) => ({
        id: toNumber(row.id),
        projectId: toNumber(row.projectId),
        agentId: toNullableNumber(row.agentId),
        datasetId: toNullableNumber(row.datasetId),
        name: row.name,
        hypothesis: row.hypothesis,
        status: row.status,
        agentName: row.agentName,
        runCount: toNumber(row.runCount),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
      pagination,
      total,
    );
  }

  async getRuns(queryValue: unknown) {
    const query = toQueryObject(queryValue);
    const pagination = parsePagination(query);
    const status = parseOptionalRunStatus(query.status);
    const experimentId = parseOptionalIdQuery(
      query.experimentId,
      'experimentId',
    );

    const conditions: string[] = [];
    const values: SqlValue[] = [];

    if (status !== undefined) {
      conditions.push('r.status = ?');
      values.push(status);
    }

    if (experimentId !== undefined) {
      conditions.push('r.experiment_id = ?');
      values.push(experimentId);
    }

    const where = toWhere(conditions);

    let total = 0;
    try {
      total = await this.count(
        `SELECT COUNT(*) AS total FROM experiment_runs r ${where}`,
        values,
      );
    } catch {
      total = 0;
    }

    let rows: RunListRow[] = [];
    try {
      const [res] = await this.database.pool.query<RunListRow[]>(
        `SELECT r.id,
                r.experiment_id AS experimentId,
                e.name AS experimentName,
                a.name AS agentName,
                r.status,
                r.params,
                r.metrics,
                r.error_message AS errorMessage,
                r.started_at AS startedAt,
                r.finished_at AS finishedAt,
                r.created_at AS createdAt
         FROM experiment_runs r
         LEFT JOIN experiments e ON e.id = r.experiment_id
         LEFT JOIN agents a ON a.id = e.agent_id
         ${where}
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ? OFFSET ?`,
        [...values, pagination.limit, pagination.offset],
      );
      rows = res;
    } catch {
      rows = [];
    }

    return toPage(
      rows.map((row) => ({
        id: toNumber(row.id),
        experimentId: toNumber(row.experimentId),
        experimentName: row.experimentName,
        agentName: row.agentName,
        status: row.status,
        params: row.params,
        metrics: row.metrics,
        errorMessage: maskErrorMessage(row.errorMessage),
        createdAt: toIso(row.createdAt),
        startedAt: toNullableIso(row.startedAt),
        finishedAt: toNullableIso(row.finishedAt),
      })),
      pagination,
      total,
    );
  }

  async getRunLogs(idValue: string, queryValue: unknown) {
    const id = parseId(idValue);
    const pagination = parsePagination(toQueryObject(queryValue));

    await this.assertRunExists(id);

    let total = 0;
    try {
      total = await this.count(
        'SELECT COUNT(*) AS total FROM agent_logs WHERE run_id = ?',
        [id],
      );
    } catch {
      total = 0;
    }

    let rows: LogListRow[] = [];
    try {
      const [res] = await this.database.pool.query<LogListRow[]>(
        `SELECT id,
                agent_id AS agentId,
                run_id AS runId,
                level,
                message,
                context,
                created_at AS createdAt
         FROM agent_logs
         WHERE run_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [id, pagination.limit, pagination.offset],
      );
      rows = res;
    } catch {
      rows = [];
    }

    return toPage(
      rows.map((row) => ({
        id: toNumber(row.id),
        agentId: toNumber(row.agentId),
        runId: toNullableNumber(row.runId),
        level: row.level,
        message: row.message,
        context: row.context,
        createdAt: toIso(row.createdAt),
      })),
      pagination,
      total,
    );
  }

  async getRunEvaluations(idValue: string, queryValue: unknown) {
    const id = parseId(idValue);
    const pagination = parsePagination(toQueryObject(queryValue));

    await this.assertRunExists(id);

    let total = 0;
    try {
      total = await this.count(
        'SELECT COUNT(*) AS total FROM evaluations WHERE run_id = ?',
        [id],
      );
    } catch {
      total = 0;
    }

    let rows: EvaluationListRow[] = [];
    try {
      const [res] = await this.database.pool.query<EvaluationListRow[]>(
        `SELECT id,
                run_id AS runId,
                benchmark,
                score,
                details,
                created_at AS createdAt
         FROM evaluations
         WHERE run_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [id, pagination.limit, pagination.offset],
      );
      rows = res;
    } catch {
      rows = [];
    }

    return toPage(
      rows.map((row) => ({
        id: toNumber(row.id),
        runId: toNumber(row.runId),
        benchmark: row.benchmark,
        score: toNumber(row.score),
        details: row.details,
        createdAt: toIso(row.createdAt),
      })),
      pagination,
      total,
    );
  }

  private async count(sql: string, values: SqlValue[] = []): Promise<number> {
    try {
      const [rows] = await this.database.pool.query<CountRow[]>(sql, values);
      return rows.length > 0 ? toNumber(rows[0].total) : 0;
    } catch {
      return 0;
    }
  }

  private async assertRunExists(id: number): Promise<void> {
    try {
      const [rows] = await this.database.pool.query<RowDataPacket[]>(
        'SELECT id FROM experiment_runs WHERE id = ? LIMIT 1',
        [id],
      );

      if (rows.length === 0) {
        throw new NotFoundException('Run not found');
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException('Run not found');
    }
  }

  async createAgent(bodyValue: unknown) {
    const body = parseBody(bodyValue);
    const name = parseString(body.name, 'name', 120, true)!;
    const description = parseOptionalText(body, 'description', 5000);
    const model = parseOptionalText(body, 'model', 120);

    let config: InputObject | null = null;
    if (body.config !== undefined) {
      config = parseJsonObject(body.config, 'config');
    }

    try {
      const [result] = await this.database.pool.execute<ResultSetHeader>(
        `INSERT INTO agents
          (name, description, model, config, status)
         VALUES (?, ?, ?, ?, 'idle')`,
        [
          name,
          description,
          model,
          config === null ? null : JSON.stringify(config),
        ],
      );

      const agent = await this.getAgentById(result.insertId);
      if (!agent) {
        throw new Error('Created agent could not be retrieved');
      }

      return agent;
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async getAgents() {
    let rows: AgentRow[] = [];
    try {
      const [res] = await this.database.pool.query<AgentRow[]>(
        `${AGENT_SELECT}
         GROUP BY a.id
         ORDER BY a.id ASC`,
      );
      rows = res;
    } catch {
      rows = [];
    }

    return rows.map((row) => this.mapAgent(row));
  }

  async getAgent(idValue: string) {
    const id = parseId(idValue);
    const agent = await this.getAgentById(id);

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return agent;
  }

  private async getAgentById(id: number) {
    let rows: AgentRow[] = [];
    try {
      const [res] = await this.database.pool.execute<AgentRow[]>(
        `${AGENT_SELECT}
         WHERE a.id = ?
         GROUP BY a.id
         LIMIT 1`,
        [id],
      );
      rows = res;
    } catch {
      rows = [];
    }

    return rows.length > 0 ? this.mapAgent(rows[0]) : null;
  }

  private mapAgent(row: AgentRow) {
    return {
      id: toNumber(row.id),
      name: row.name,
      description: row.description,
      model: row.model,
      config: row.config,
      status: row.status,
      runs: toNumber(row.runs),
      succeeded: toNumber(row.succeeded),
      failed: toNumber(row.failed),
      avgScore: toNullableNumber(row.avgScore),
      createdAt: toIso(row.created_at),
    };
  }

  async createExperiment(bodyValue: unknown) {
    const body = parseBody(bodyValue);
    const projectId = parsePositiveId(body.projectId, 'projectId');
    const name = parseString(body.name, 'name', 120, true)!;
    const hypothesis = parseOptionalText(body, 'hypothesis', 5000);

    let agentId: number | null = null;
    if (body.agentId !== undefined && body.agentId !== null) {
      agentId = parsePositiveId(body.agentId, 'agentId');
    }

    const [projectRows] = await this.database.pool.execute<RowDataPacket[]>(
      'SELECT id FROM research_projects WHERE id = ? LIMIT 1',
      [projectId],
    );
    if (projectRows.length === 0) {
      throw new NotFoundException('Project not found');
    }

    if (agentId !== null) {
      const [agentRows] = await this.database.pool.execute<RowDataPacket[]>(
        'SELECT id FROM agents WHERE id = ? LIMIT 1',
        [agentId],
      );
      if (agentRows.length === 0) {
        throw new NotFoundException('Agent not found');
      }
    }

    try {
      const [result] = await this.database.pool.execute<ResultSetHeader>(
        `INSERT INTO experiments
          (project_id, agent_id, name, hypothesis)
         VALUES (?, ?, ?, ?)`,
        [projectId, agentId, name, hypothesis],
      );

      const [rows] = await this.database.pool.execute<ExperimentRow[]>(
        `SELECT id, project_id, agent_id, name, hypothesis, status, created_at
         FROM experiments
         WHERE id = ?
         LIMIT 1`,
        [result.insertId],
      );

      if (rows.length === 0) {
        throw new Error('Created experiment could not be retrieved');
      }

      return this.mapExperiment(rows[0]);
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async createRun(experimentIdValue: string, bodyValue: unknown) {
    const experimentId = parseId(experimentIdValue);
    const body = parseBody(bodyValue);

    let params: InputObject | null = null;
    if (body.params !== undefined) {
      params = parseJsonObject(body.params, 'params');
    }

    const [experimentRows] = await this.database.pool.execute<RowDataPacket[]>(
      'SELECT id FROM experiments WHERE id = ? LIMIT 1',
      [experimentId],
    );
    if (experimentRows.length === 0) {
      throw new NotFoundException('Experiment not found');
    }

    try {
      const [result] = await this.database.pool.execute<ResultSetHeader>(
        `INSERT INTO experiment_runs (experiment_id, params, status)
         VALUES (?, ?, 'queued')`,
        [experimentId, params === null ? null : JSON.stringify(params)],
      );

      const [rows] = await this.database.pool.execute<RunRow[]>(
        `SELECT id, experiment_id, status, metrics, error_message,
                created_at, started_at, finished_at
         FROM experiment_runs
         WHERE id = ?
         LIMIT 1`,
        [result.insertId],
      );

      if (rows.length === 0) {
        throw new Error('Created run could not be retrieved');
      }

      return this.mapRun(rows[0]);
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async getRun(idValue: string) {
    const id = parseId(idValue);

    let rows: RunRow[] = [];
    try {
      const [res] = await this.database.pool.execute<RunRow[]>(
        `SELECT id, experiment_id, status, metrics, error_message,
                created_at, started_at, finished_at
         FROM experiment_runs
         WHERE id = ?
         LIMIT 1`,
        [id],
      );
      rows = res;
    } catch {
      rows = [];
    }

    if (rows.length === 0) {
      throw new NotFoundException('Run not found');
    }

    return this.mapRun(rows[0]);
  }

  async cancelRun(idValue: string) {
    const id = parseId(idValue);

    const [result] = await this.database.pool.query<ResultSetHeader>(
      `UPDATE experiment_runs
       SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'queued'`,
      [id],
    );

    if (result.affectedRows > 0) {
      return this.getRun(idValue);
    }

    const [rows] = await this.database.pool.query<RowDataPacket[]>(
      'SELECT id FROM experiment_runs WHERE id = ? LIMIT 1',
      [id],
    );

    if (rows.length === 0) {
      throw new NotFoundException('Run not found');
    }

    throw new ConflictException('Only queued runs can be cancelled');
  }

  private mapExperiment(row: ExperimentRow) {
    return {
      id: toNumber(row.id),
      projectId: toNumber(row.project_id),
      agentId: row.agent_id === null ? null : toNumber(row.agent_id),
      name: row.name,
      hypothesis: row.hypothesis,
      status: row.status,
      createdAt: toIso(row.created_at),
    };
  }

  private mapRun(row: RunRow) {
    return {
      id: toNumber(row.id),
      experimentId: toNumber(row.experiment_id),
      status: row.status,
      metrics: row.metrics,
      errorMessage: maskErrorMessage(row.error_message),
      createdAt: toIso(row.created_at),
      startedAt: toNullableIso(row.started_at),
      finishedAt: toNullableIso(row.finished_at),
    };
  }

  private handleWriteError(error: unknown): never {
    if (error instanceof BadRequestException) {
      throw error;
    }

    if (error instanceof NotFoundException) {
      throw error;
    }

    if (error instanceof ConflictException) {
      throw error;
    }

    if (isRecord(error)) {
      const code = typeof error.code === 'string' ? error.code : '';
      if (code === 'ER_DUP_ENTRY' || code === 'ER_DUP_KEY') {
        throw new ConflictException('Resource already exists');
      }
      if (code === 'ER_NO_REFERENCED_ROW_2') {
        throw new NotFoundException('Referenced record not found');
      }
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new InternalServerErrorException('Unknown database error');
  }
}

function maskErrorMessage(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null;
  }

  return MASKED_ERROR;
}

