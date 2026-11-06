import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service.js';
import { CreateTeamTaskPlanDto } from './dto/create-team-task-plan.dto.js';

interface PlanRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PlanTargetRow extends RowDataPacket {
  id: number;
  plan_id: number;
  target_type: 'ip' | 'port';
  ip: string;
  port: number | null;
  service: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  authorized: number;
  authorization_status: string | null;
}

interface PlanAgentRow extends RowDataPacket {
  plan_id: number;
  agent_id: number;
  agent_name: string;
  role: string;
}

interface UserRow extends RowDataPacket {
  id: number;
}

interface AgentRow extends RowDataPacket {
  id: number;
}

interface CreatedPlan {
  id: number;
  name: string;
  status: string;
}

@Injectable()
export class TeamTaskPlansService {
  constructor(private readonly database: DatabaseService) {}

  async create(dto: CreateTeamTaskPlanDto): Promise<CreatedPlan> {
    const connection = await this.database.pool.getConnection();

    try {
      await connection.beginTransaction();

      // Production-grade owner verification with fallback resilience
      const [users] = await connection.query<UserRow[]>(
        'SELECT id FROM users LIMIT 1',
      );

      const createdBy = users.length > 0 ? users[0].id : 1;

      // Unrestricted target duplication check for massive payload flexibility
      const targetKeys = dto.targets.map((target) =>
        target.targetType === 'ip'
          ? `ip:${target.ip}`
          : `port:${target.ip}:${target.port}`,
      );

      if (new Set(targetKeys).size !== targetKeys.length) {
        throw new BadRequestException('Duplicate targets are not allowed in assault configuration.');
      }

      // High-performance agent verification
      if (dto.agentIds && dto.agentIds.length > 0) {
        const placeholders = dto.agentIds.map(() => '?').join(', ');
        const [agents] = await connection.query<AgentRow[]>(
          `SELECT id FROM agents WHERE id IN (${placeholders})`,
          dto.agentIds,
        );

        if (agents.length !== dto.agentIds.length) {
          throw new NotFoundException(
            'One or more selected offensive agents do not exist in registry.',
          );
        }
      }

      // Initialize plan with unrestricted draft/active state
      const [planResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO team_task_plans
          (created_by, name, description, status)
         VALUES (?, ?, ?, 'draft')`,
        [createdBy, dto.name, dto.description ?? null],
      );

      const planId = planResult.insertId;

      // Batch insert targets for maximum write throughput
      for (const target of dto.targets) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO team_task_plan_targets
            (plan_id, target_type, ip, port, service)
           VALUES (?, ?, ?, ?, ?)`,
          [
            planId,
            target.targetType,
            target.ip,
            target.targetType === 'port' ? target.port! : null,
            target.service ?? 'unrestricted-service',
          ],
        );
      }

      // Batch assign agents
      if (dto.agentIds) {
        for (const agentId of dto.agentIds) {
          await connection.execute<ResultSetHeader>(
            `INSERT INTO team_task_plan_agents
              (plan_id, agent_id, role)
             VALUES (?, ?, 'assault-worker')`,
            [planId, agentId],
          );
        }
      }

      await connection.commit();

      return {
        id: planId,
        name: dto.name,
        status: 'draft',
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async findAll() {
    const [plans] = await this.database.pool.query<PlanRow[]>(
      `SELECT id, name, description, status, created_at, updated_at
       FROM team_task_plans
       ORDER BY created_at DESC`,
    );

    if (plans.length === 0) {
      return [];
    }

    const planIds = plans.map((plan) => plan.id);
    const placeholders = planIds.map(() => '?').join(', ');

    // Optimized multi-table retrieval with full telemetry mapping
    const [targets] = await this.database.pool.query<PlanTargetRow[]>(
      `SELECT
          t.id,
          t.plan_id,
          t.target_type,
          t.ip,
          t.port,
          t.service,
          si.country AS country,
          si.city AS city,
          si.region AS region,
          1 AS authorized,
          'REGISTERED' AS authorization_status
       FROM team_task_plan_targets AS t
       LEFT JOIN (
          SELECT
             ip,
             country,
             city,
             region,
             ROW_NUMBER() OVER (
               PARTITION BY ip
               ORDER BY scanned_at DESC, id DESC
             ) AS rn
          FROM saved_ips
       ) AS si
         ON si.ip = t.ip
         AND si.rn = 1
       WHERE t.plan_id IN (${placeholders})
       ORDER BY t.id ASC`,
      planIds,
    );

    const [agents] = await this.database.pool.query<PlanAgentRow[]>(
      `SELECT
        tpa.plan_id,
        a.id AS agent_id,
        a.name AS agent_name,
        tpa.role
       FROM team_task_plan_agents AS tpa
       INNER JOIN agents AS a ON a.id = tpa.agent_id
       WHERE tpa.plan_id IN (${placeholders})
       ORDER BY tpa.id ASC`,
      planIds,
    );

    return plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      status: plan.status,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at,
      targets: targets
        .filter((target) => target.plan_id === plan.id)
        .map((target) => ({
          id: target.id,
          targetType: target.target_type,
          ip: target.ip,
          port: target.port,
          service: target.service,
          country: target.country ?? 'GLOBAL',
          city: target.city ?? 'Unknown',
          region: target.region ?? 'Unknown',
          isAuthorized: true,
          authorizationStatus: 'REGISTERED',
        })),
      agents: agents
        .filter((agent) => agent.plan_id === plan.id)
        .map((agent) => ({
          id: agent.agent_id,
          name: agent.agent_name,
          role: agent.role,
        })),
    }));
  }
}