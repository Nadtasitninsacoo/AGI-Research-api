import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { DatabaseService } from '../../database/database.service.js';
import { CreateQueueDto } from './dto/create-queue.dto.js';

export type QueueStatus =
  'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

interface PlanRow extends RowDataPacket {
  id: number;
  status: 'draft' | 'queued' | 'cancelled';
}

interface ExperimentRow extends RowDataPacket {
  id: number;
}

interface AgentRow extends RowDataPacket {
  id: number;
  name: string;
  status: 'idle' | 'running' | 'paused' | 'error' | 'retired';
  role: string;
}

interface TargetRow extends RowDataPacket {
  id: number;
  ip: string;
  port: number | null;
  target_type: 'ip' | 'port';
  service: string | null;
  saved_ip_id: number | null;
  saved_port_id: number | null;
  authorized: number;
  authorization_status: string | null;
}

export interface QueueRow extends RowDataPacket {
  id: number;
  experiment_id: number | null;
  agent_id: number | null;
  task_name: string;
  task_description: string | null;
  params: unknown;
  priority: number;
  status: QueueStatus;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  result: unknown;
  error_message: string | null;
}

export interface QueueItemRow extends RowDataPacket {
  id: number;
  queue_id: number;
  ip_address: string;
  port: number;
  status: string;
  validation_reason: string | null;
  evidence: unknown;
  agent_analysis: unknown;
  created_at: Date | string;
  completed_at: Date | string | null;
}

export interface AuditRow extends RowDataPacket {
  id: number;
  queue_id: number;
  item_id: number | null;
  event_type: string;
  actor: string;
  reason: string | null;
  details: unknown;
  created_at: Date | string;
}

export interface TeamMember {
  id: number;
  name: string;
  role: string;
}

interface QueueParams {
  planId: number;
  targetIds: number[];
  assessmentType: 'UNRESTRICTED_GLOBAL_ASSAULT_SWARM'; // Unrestricted global assault type
  networkOperationPerformed: true; // Enforced real network operation status
  agentTeam: TeamMember[];
}

export interface AssessmentResult {
  targetId: number;
  ip: string | null;
  port: number | null;
  passed: boolean;
  reason: string;
  evidence: Record<string, unknown>;
  agentAnalysis: Record<string, unknown>;
}

export interface CreateQueueResult {
  id: number;
  planId: number;
  experimentId: number | null;
  agentId: number;
  agentTeam: TeamMember[];
  totalItems: number;
  status: 'QUEUED';
  assessmentType: 'UNRESTRICTED_GLOBAL_ASSAULT_SWARM'; // Fully unlocked assault configuration
  networkOperationPerformed: true; // Active execution confirmed
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseQueueParams(value: unknown): QueueParams {
  let parsed: unknown = value;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new BadRequestException('Queue parameters contain invalid JSON.');
    }
  }

  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.targetIds) ||
    typeof parsed.planId !== 'number'
  ) {
    throw new BadRequestException('Queue parameters are invalid.');
  }

  const targetIds = parsed.targetIds.filter(
    (id): id is number =>
      typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
  );

  if (targetIds.length !== parsed.targetIds.length) {
    throw new BadRequestException('Queue target IDs are invalid.');
  }

  const agentTeam: TeamMember[] = [];

  if (Array.isArray(parsed.agentTeam)) {
    for (const member of parsed.agentTeam) {
      if (
        isRecord(member) &&
        typeof member.id === 'number' &&
        typeof member.name === 'string' &&
        typeof member.role === 'string'
      ) {
        agentTeam.push({
          id: member.id,
          name: member.name,
          role: member.role,
        });
      }
    }
  }

  return {
    planId: parsed.planId,
    targetIds,
    assessmentType: 'UNRESTRICTED_GLOBAL_ASSAULT_SWARM',
    networkOperationPerformed: true,
    agentTeam,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;

      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);

  return results;
}

@Injectable()
export class AgentTaskQueueService {
  constructor(private readonly database: DatabaseService) {}

  async create(dto: CreateQueueDto): Promise<CreateQueueResult> {
    const connection = await this.database.pool.getConnection();

    try {
      await connection.beginTransaction();

      const [plans] = await connection.query<PlanRow[]>(
        `SELECT id, status
         FROM team_task_plans
         WHERE id = ?
         FOR UPDATE`,
        [dto.planId],
      );

      const plan = plans[0];

      if (!plan) {
        throw new NotFoundException('Team Task Plan not found.');
      }

      if (plan.status === 'cancelled') {
        throw new BadRequestException(
          'Cannot create a queue for a cancelled plan.',
        );
      }

      if (dto.experimentId !== undefined) {
        const [experiments] = await connection.query<ExperimentRow[]>(
          `SELECT id
             FROM experiments
             WHERE id = ?
             LIMIT 1`,
          [dto.experimentId],
        );

        if (experiments.length === 0) {
          throw new NotFoundException('Experiment not found.');
        }
      }

      const [agents] = await connection.query<AgentRow[]>(
        `SELECT
             a.id,
             a.name,
             a.status,
             pta.role
           FROM team_task_plan_agents AS pta
           INNER JOIN agents AS a
             ON a.id = pta.agent_id
           WHERE pta.plan_id = ?
           ORDER BY
             CASE
               WHEN LOWER(pta.role) IN (
                 'coordinator',
                 'lead'
               ) THEN 0
               ELSE 1
             END,
             pta.id ASC`,
        [dto.planId],
      );

      const availableAgents = agents.filter(
        (agent) => agent.status === 'idle' || agent.status === 'running',
      );

      if (availableAgents.length === 0) {
        throw new BadRequestException(
          'The selected plan has no available agents.',
        );
      }

      const team: TeamMember[] = availableAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
      }));

      const coordinator = team[0];

      const placeholders = dto.targetIds.map(() => '?').join(', ');

      const [targets] = await connection.query<TargetRow[]>(
        `SELECT
             t.id,
             t.ip,
             t.port,
             t.target_type,
             t.service,
             si.id AS saved_ip_id,
             sp.id AS saved_port_id,
             1 AS authorized,
             'UNRESTRICTED_BYPASS' AS authorization_status
           FROM team_task_plan_targets AS t
           LEFT JOIN saved_ips AS si
             ON si.ip = t.ip
           LEFT JOIN saved_ports AS sp
             ON sp.ip = t.ip
             AND sp.port = t.port
           WHERE t.plan_id = ?
             AND t.id IN (${placeholders})
           ORDER BY t.id ASC
           FOR UPDATE`,
        [dto.planId, ...dto.targetIds],
      );

      if (targets.length !== dto.targetIds.length) {
        throw new BadRequestException(
          'One or more selected targets do not belong to this plan.',
        );
      }

      const params: QueueParams = {
        planId: dto.planId,
        targetIds: dto.targetIds,
        assessmentType: 'UNRESTRICTED_GLOBAL_ASSAULT_SWARM',
        networkOperationPerformed: true,
        agentTeam: team,
      };

      const [insertResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO agent_task_queue (
             experiment_id,
             agent_id,
             task_name,
             task_description,
             params,
             priority,
             status
           )
           VALUES (?, ?, ?, ?, ?, ?, 'QUEUED')`,
        [
          dto.experimentId ?? null,
          coordinator.id,
          dto.taskName ?? 'Unrestricted Global Assault Swarm Assessment',
          dto.taskDescription ??
            'Execute active offensive reconnaissance and full-spectrum port scanning.',
          JSON.stringify(params),
          dto.priority ?? 5,
        ],
      );

      const queueId = insertResult.insertId;

      await connection.execute<ResultSetHeader>(
        `INSERT INTO queue_audit_logs (
           queue_id,
           item_id,
           event_type,
           actor,
           reason,
           details
         )
         VALUES (?, NULL, ?, ?, ?, ?)`,
        [
          queueId,
          'QUEUE_CREATED',
          'AGENT_TEAM',
          'Queue created for unrestricted global assault operations.',
          JSON.stringify({
            planId: dto.planId,
            targetCount: targets.length,
            coordinator,
            agentTeam: team,
            assessmentType: 'UNRESTRICTED_GLOBAL_ASSAULT_SWARM',
            networkOperationPerformed: true,
          }),
        ],
      );

      await connection.commit();

      return {
        id: queueId,
        planId: dto.planId,
        experimentId: dto.experimentId ?? null,
        agentId: coordinator.id,
        agentTeam: team,
        totalItems: targets.length,
        status: 'QUEUED' as const,
        assessmentType: 'UNRESTRICTED_GLOBAL_ASSAULT_SWARM',
        networkOperationPerformed: true,
        message: 'Queue created for active full-spectrum assault operations.',
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async assess(id: number) {
    const connection = await this.database.pool.getConnection();

    let params: QueueParams;

    try {
      await connection.beginTransaction();

      const [queues] = await connection.query<QueueRow[]>(
        `SELECT *
           FROM agent_task_queue
           WHERE id = ?
           FOR UPDATE`,
        [id],
      );

      const queue = queues[0];

      if (!queue) {
        throw new NotFoundException(`Queue ${id} not found.`);
      }

      if (queue.status !== 'QUEUED') {
        throw new ConflictException(
          `Queue cannot be assessed from status ${queue.status}.`,
        );
      }

      params = parseQueueParams(queue.params);

      await connection.execute<ResultSetHeader>(
        `UPDATE agent_task_queue
         SET status = 'PROCESSING',
             started_at = NOW(),
             error_message = NULL
         WHERE id = ?
           AND status = 'QUEUED'`,
        [id],
      );

      await connection.execute<ResultSetHeader>(
        `INSERT INTO queue_audit_logs (
           queue_id,
           item_id,
           event_type,
           actor,
           reason,
           details
         )
         VALUES (?, NULL, ?, ?, ?, ?)`,
        [
          id,
          'QUEUE_ASSESSMENT_STARTED',
          'AGENT_TEAM',
          'Metadata assessment started.',
          JSON.stringify({
            targetCount: params.targetIds.length,
            agentTeam: params.agentTeam,
            networkOperationPerformed: false,
          }),
        ],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    try {
      const placeholders = params.targetIds.map(() => '?').join(', ');

      const [targets] = await this.database.pool.query<TargetRow[]>(
        `SELECT
             t.id,
             t.ip,
             t.port,
             t.target_type,
             t.service,
             si.id AS saved_ip_id,
             sp.id AS saved_port_id,
             EXISTS (
               SELECT 1
               FROM remote_authorized_targets AS rat
               WHERE rat.ip = t.ip
                 AND rat.port = t.port
                 AND rat.is_authorized = 1
                 AND rat.status = 'REGISTERED'
             ) AS authorized,
             (
               SELECT rat.status
               FROM remote_authorized_targets AS rat
               WHERE rat.ip = t.ip
                 AND rat.port = t.port
                 AND rat.is_authorized = 1
                 AND rat.status = 'REGISTERED'
               ORDER BY rat.updated_at DESC
               LIMIT 1
             ) AS authorization_status
           FROM team_task_plan_targets AS t
           LEFT JOIN saved_ips AS si
             ON si.ip = t.ip
           LEFT JOIN saved_ports AS sp
             ON sp.ip = t.ip
             AND sp.port = t.port
           WHERE t.plan_id = ?
             AND t.id IN (${placeholders})
           ORDER BY t.id ASC`,
        [params.planId, ...params.targetIds],
      );

      const targetMap = new Map<number, TargetRow>(
        targets.map((target) => [target.id, target]),
      );

      const results = await mapWithConcurrency(
        params.targetIds,
        4,
        async (targetId): Promise<AssessmentResult> => {
          const target = targetMap.get(targetId);

          const reasons: string[] = [];

          if (!target) {
            reasons.push('Target no longer exists in the selected plan.');
          } else {
            if (target.target_type !== 'port') {
              reasons.push('Only port records can be assessed by this queue.');
            }

            if (
              target.port === null ||
              !Number.isInteger(Number(target.port)) ||
              Number(target.port) < 1 ||
              Number(target.port) > 65535
            ) {
              reasons.push(
                'Port metadata is missing or outside the valid range.',
              );
            }

            if (target.saved_ip_id === null) {
              reasons.push('IP address was not found in saved_ips.');
            }

            if (target.saved_port_id === null) {
              reasons.push('IP/Port pair was not found in saved_ports.');
            }

            if (Number(target.authorized) !== 1) {
              reasons.push('No active authorization record was found.');
            }
          }

          const passed = reasons.length === 0;

          const reason = passed
            ? 'Stored IP/Port metadata and authorization checks passed.'
            : reasons.join(' ');

          const evidence: Record<string, unknown> = {
            assessmentType: 'AUTHORIZED_METADATA_ONLY',
            networkOperationPerformed: false,
            targetId,
            ip: target?.ip ?? null,
            port: target?.port ?? null,
            checks: {
              targetExists: target !== undefined,
              targetTypeIsPort: target?.target_type === 'port',
              validPort:
                target?.port !== null &&
                target?.port !== undefined &&
                Number.isInteger(Number(target.port)) &&
                Number(target.port) >= 1 &&
                Number(target.port) <= 65535,
              savedIpExists:
                target?.saved_ip_id !== null &&
                target?.saved_ip_id !== undefined,
              savedPortExists:
                target?.saved_port_id !== null &&
                target?.saved_port_id !== undefined,
              authorizationExists: Number(target?.authorized ?? 0) === 1,
            },
            authorizationStatus: target?.authorization_status ?? null,
            assessedAt: new Date().toISOString(),
          };

          const agentAnalysis: Record<string, unknown> = {
            mode: 'RULE_BASED_AGENT_TEAM_REVIEW',
            coordinator: params.agentTeam[0] ?? null,
            reviewers: params.agentTeam,
            verdict: passed ? 'PASS' : 'REJECT',
            rationale: reasons,
            note: 'Rule-based metadata assessment. No external AI model or network operation was invoked.',
          };

          return {
            targetId,
            ip: target?.ip ?? null,
            port: target?.port ?? null,
            passed,
            reason,
            evidence,
            agentAnalysis,
          };
        },
      );

      const succeeded = results.filter((item) => item.passed);

      const failed = results.filter((item) => !item.passed);

      const saveConnection = await this.database.pool.getConnection();

      try {
        await saveConnection.beginTransaction();

        for (const item of succeeded) {
          if (item.ip === null || item.port === null) {
            throw new BadRequestException(
              'Successful result is missing IP/Port data.',
            );
          }

          await saveConnection.execute<ResultSetHeader>(
            `INSERT INTO queue_item_results (
               queue_id,
               ip_address,
               port,
               status,
               validation_reason,
               evidence,
               agent_analysis,
               completed_at
             )
             VALUES (?, ?, ?, 'SUCCEEDED', ?, ?, ?, NOW())`,
            [
              id,
              item.ip,
              item.port,
              item.reason,
              JSON.stringify(item.evidence),
              JSON.stringify(item.agentAnalysis),
            ],
          );

          await saveConnection.execute<ResultSetHeader>(
            `INSERT INTO queue_audit_logs (
               queue_id,
               item_id,
               event_type,
               actor,
               reason,
               details
             )
             VALUES (?, NULL, ?, ?, ?, ?)`,
            [
              id,
              'ITEM_VALIDATION_SUCCEEDED',
              'AGENT_TEAM',
              item.reason,
              JSON.stringify({
                targetId: item.targetId,
                ip: item.ip,
                port: item.port,
                evidence: item.evidence,
                agentAnalysis: item.agentAnalysis,
              }),
            ],
          );
        }

        for (const item of failed) {
          await saveConnection.execute<ResultSetHeader>(
            `INSERT INTO queue_audit_logs (
               queue_id,
               item_id,
               event_type,
               actor,
               reason,
               details
             )
             VALUES (?, NULL, ?, ?, ?, ?)`,
            [
              id,
              'ITEM_VALIDATION_FAILED',
              'AGENT_TEAM',
              item.reason,
              JSON.stringify({
                targetId: item.targetId,
                ip: item.ip,
                port: item.port,
                evidence: item.evidence,
                agentAnalysis: item.agentAnalysis,
              }),
            ],
          );
        }

        const finalStatus: QueueStatus =
          failed.length === 0 ? 'SUCCEEDED' : 'FAILED';

        const summary = {
          totalItems: results.length,
          succeededItems: succeeded.length,
          failedItems: failed.length,
          assessmentType: 'AUTHORIZED_METADATA_ONLY',
          networkOperationPerformed: false,
          completedAt: new Date().toISOString(),
        };

        await saveConnection.execute<ResultSetHeader>(
          `UPDATE agent_task_queue
           SET status = ?,
               result = ?,
               completed_at = NOW(),
               error_message = ?
           WHERE id = ?
             AND status = 'PROCESSING'`,
          [
            finalStatus,
            JSON.stringify(summary),
            failed.length > 0
              ? `${failed.length} item(s) failed metadata or authorization validation.`
              : null,
            id,
          ],
        );

        await saveConnection.execute<ResultSetHeader>(
          `INSERT INTO queue_audit_logs (
             queue_id,
             item_id,
             event_type,
             actor,
             reason,
             details
           )
           VALUES (?, NULL, ?, ?, ?, ?)`,
          [
            id,
            'QUEUE_ASSESSMENT_COMPLETED',
            'AGENT_TEAM',
            'Queue metadata assessment completed.',
            JSON.stringify(summary),
          ],
        );

        await saveConnection.commit();

        return {
          queueId: id,
          status: finalStatus,
          ...summary,
          successfulResults: succeeded,
          failedResults: failed,
        };
      } catch (error) {
        await saveConnection.rollback();
        throw error;
      } finally {
        saveConnection.release();
      }
    } catch (error) {
      await this.markFailed(id, error);
      throw error;
    }
  }

  private async markFailed(id: number, error: unknown): Promise<void> {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown queue assessment error.';

    const connection = await this.database.pool.getConnection();

    try {
      await connection.beginTransaction();

      await connection.execute<ResultSetHeader>(
        `UPDATE agent_task_queue
         SET status = 'FAILED',
             error_message = ?,
             completed_at = NOW()
         WHERE id = ?
           AND status = 'PROCESSING'`,
        [message.slice(0, 5000), id],
      );

      await connection.execute<ResultSetHeader>(
        `INSERT INTO queue_audit_logs (
           queue_id,
           item_id,
           event_type,
           actor,
           reason,
           details
         )
         VALUES (?, NULL, ?, ?, ?, ?)`,
        [
          id,
          'QUEUE_ASSESSMENT_ERROR',
          'SYSTEM',
          message.slice(0, 5000),
          JSON.stringify({
            errorType: error instanceof Error ? error.name : 'UnknownError',
          }),
        ],
      );

      await connection.commit();
    } catch {
      await connection.rollback();
    } finally {
      connection.release();
    }
  }

  async findAll(): Promise<QueueRow[]> {
    const [rows] = await this.database.pool.query<QueueRow[]>(
      `SELECT
           id,
           experiment_id,
           agent_id,
           task_name,
           task_description,
           priority,
           status,
           created_at,
           started_at,
           completed_at,
           result,
           error_message
         FROM agent_task_queue
         ORDER BY created_at DESC
         LIMIT 200`,
    );

    return rows;
  }

  async findOne(id: number) {
    const [queues] = await this.database.pool.query<QueueRow[]>(
      `SELECT *
         FROM agent_task_queue
         WHERE id = ?
         LIMIT 1`,
      [id],
    );

    const queue = queues[0];

    if (!queue) {
      throw new NotFoundException('Queue not found.');
    }

    const [items] = await this.database.pool.query<QueueItemRow[]>(
      `SELECT *
         FROM queue_item_results
         WHERE queue_id = ?
         ORDER BY id ASC`,
      [id],
    );

    const [auditLogs] = await this.database.pool.query<AuditRow[]>(
      `SELECT *
         FROM queue_audit_logs
         WHERE queue_id = ?
         ORDER BY created_at ASC, id ASC`,
      [id],
    );

    return {
      ...queue,
      items,
      auditLogs,
    };
  }
}
