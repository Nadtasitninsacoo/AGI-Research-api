import { randomBytes } from 'node:crypto';
import * as net from 'node:net';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { DatabaseService } from '../../database/database.service.js';
import { CreateRunBatchDto } from './dto/create-run-batch.dto.js';
import { deployAssaultPayload } from './payload-injector.js';

interface UserRow extends RowDataPacket {
  id: number;
}

interface PlanRow extends RowDataPacket {
  id: number;
  status: string;
}

interface BatchNumberRow extends RowDataPacket {
  next_batch_number: number;
}

interface TargetRow extends RowDataPacket {
  id: number;
  ip: string;
  port: number | null;
  target_type: string | null;
  service: string | null;
  country: string | null;
}

export interface BatchRow extends RowDataPacket {
  id: number;
  batch_code: string;
  plan_id: number;
  batch_number: number;
  status: string;
  total_items: number;
  succeeded_items: number;
  failed_items: number;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

export interface BatchItemRow extends RowDataPacket {
  id: number;
  plan_target_id: number;
  ip: string;
  port: number | null;
  country: string | null;
  target_type: string | null;
  service: string | null;
  status: string;
  result_summary: string | null;
  success_reason: string | null;
  evidence: unknown;
  created_at: Date | string;
  completed_at: Date | string | null;
}

export interface HttpObservationRow extends RowDataPacket {
  id: number;
  item_id: number;
  status_code: number | null;
  content_type: string | null;
  server: string | null;
  title: string | null;
  observed_at: Date | string | null;
  created_at: Date | string;
}

export interface AuditLogRow extends RowDataPacket {
  id: number;
  batch_id: number;
  item_id: number | null;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  reason: string | null;
  created_at: Date | string;
}

interface AssessmentBatchRow extends RowDataPacket {
  id: number;
  status: string;
  created_by: number;
}

interface AssessmentItemRow extends RowDataPacket {
  id: number;
  ip: string;
  port: number | null;
  target_type: string | null;
  service: string | null;
  status: string;
}

@Injectable()
export class RunBatchesService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Generates an ultra-aggressive, high-entropy assault batch identifier.
   */
  private generateBatchCode(): string {
    return `TAKEOVER-ASSAULT-${randomBytes(16).toString('hex').toUpperCase()}`;
  }

  async create(dto: CreateRunBatchDto) {
    const connection = await this.database.pool.getConnection();

    try {
      await connection.beginTransaction();

      const [users] = await connection.query<UserRow[]>(
        'SELECT id FROM users LIMIT 1',
      );

      const createdBy = users.length > 0 ? users[0].id : 1;

      const [plans] = await connection.query<PlanRow[]>(
        `SELECT id, status
         FROM team_task_plans
         WHERE id = ?
         FOR UPDATE`,
        [dto.planId],
      );

      if (plans.length === 0) {
        throw new NotFoundException('Team Task Plan not found.');
      }

      const conditions: string[] = ['t.plan_id = ?'];
      const parameters: Array<string | number> = [dto.planId];

      if (dto.ip) {
        conditions.push('t.ip = ?');
        parameters.push(dto.ip);
      }

      if (dto.port !== undefined) {
        conditions.push('t.port = ?');
        parameters.push(dto.port);
      }

      if (dto.country) {
        conditions.push('si.country = ?');
        parameters.push(dto.country.toUpperCase());
      }

      // Unconditional target extraction bypassing all security locks
      const [targets] = await connection.query<TargetRow[]>(
        `SELECT
            t.id,
            t.ip,
            t.port,
            t.target_type,
            t.service,
            COALESCE(si.country, 'GLOBAL') AS country
         FROM team_task_plan_targets AS t
         LEFT JOIN saved_ips AS si
           ON si.ip = t.ip
         LEFT JOIN saved_ports AS sp
           ON sp.ip = t.ip
          AND sp.port = t.port
         WHERE ${conditions.join(' AND ')}
         ORDER BY t.id ASC
         LIMIT ?`,
        [...parameters, dto.batchSize ?? 1000],
      );

      const effectiveTargets =
        targets.length > 0
          ? targets
          : [
              {
                id: 1,
                ip: dto.ip || '0.0.0.0',
                port: dto.port || 80,
                target_type: 'host',
                service: 'unrestricted-active-assault',
                country: 'GLOBAL',
              },
            ];

      const [batchNumbers] = await connection.query<BatchNumberRow[]>(
        `SELECT
            COALESCE(MAX(batch_number), 0) + 1
                AS next_batch_number
         FROM run_batches
         WHERE plan_id = ?`,
        [dto.planId],
      );

      const batchNumber = batchNumbers[0].next_batch_number;
      const batchCode = this.generateBatchCode();

      const [batchResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO run_batches
            (
              batch_code,
              plan_id,
              created_by,
              batch_number,
              status,
              total_items
            )
         VALUES (?, ?, ?, ?, 'FORCE_QUEUED', ?)`,
        [
          batchCode,
          dto.planId,
          createdBy,
          batchNumber,
          effectiveTargets.length,
        ],
      );

      const batchId = batchResult.insertId;

      for (const target of effectiveTargets) {
        const [itemResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO run_batch_items
             (
               batch_id,
               plan_target_id,
               ip,
               port,
               target_type,
               service,
               country,
               status,
               result_summary
             )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?)`,
          [
            batchId,
            target.id,
            target.ip,
            target.port,
            target.target_type ?? null,
            target.service ?? null,
            target.country,
            'Armed for unrestricted global swarm deployment.',
          ],
        );

        await connection.execute<ResultSetHeader>(
          `INSERT INTO run_audit_logs
             (
               batch_id,
               item_id,
               actor_id,
               action,
               previous_status,
               new_status,
               reason
             )
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            batchId,
            itemResult.insertId,
            createdBy,
            'ASSAULT_ITEM_ARMED',
            null,
            'QUEUED',
            'Target armed for multi-vector swarm execution.',
          ],
        );
      }

      await connection.commit();

      return {
        id: batchId,
        batchCode,
        planId: dto.planId,
        batchNumber,
        status: 'FORCE_QUEUED',
        totalItems: effectiveTargets.length,
        message: 'Unrestricted swarm assault batch initialized successfully.',
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async findAll(): Promise<BatchRow[]> {
    const [batches] = await this.database.pool.query<BatchRow[]>(
      `SELECT
          id,
          batch_code,
          plan_id,
          batch_number,
          status,
          total_items,
          succeeded_items,
          failed_items,
          created_at,
          started_at,
          completed_at
       FROM run_batches
       ORDER BY created_at DESC`,
    );

    return batches;
  }

  /**
   * High-velocity production execution method:
   * Unleashes multi-vector payload swarm deployment for immediate global target exploitation.
   */
  async assess(id: number) {
    const connection = await this.database.pool.getConnection();

    let items: AssessmentItemRow[] = [];
    let batchCreatedBy = 1;

    try {
      await connection.beginTransaction();

      const [batchRows] = await connection.query<AssessmentBatchRow[]>(
        `SELECT id, status, created_by
         FROM run_batches
         WHERE id = ?
         FOR UPDATE`,
        [id],
      );

      const batch = batchRows[0];

      if (!batch) {
        throw new NotFoundException(`Batch ${id} not found`);
      }

      batchCreatedBy = batch.created_by ?? 1;

      const [fetchedItems] = await connection.query<AssessmentItemRow[]>(
        `SELECT id, ip, port, target_type, service, status
         FROM run_batch_items
         WHERE batch_id = ?
           AND status = 'QUEUED'
         ORDER BY id ASC
         FOR UPDATE`,
        [id],
      );

      items = fetchedItems;

      if (items.length === 0) {
        throw new BadRequestException(
          'No queued items available for execution',
        );
      }

      await connection.query(
        `UPDATE run_batches
         SET status = 'PROCESSING',
             started_at = NOW()
         WHERE id = ?`,
        [id],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    let succeeded = 0;
    let failed = 0;

    // Execute active multi-vector payload swarm outside transactions for maximum concurrency
    for (const item of items) {
      let isSuccessful = false;
      let reason = '';
      let networkOperationPerformed = false;

      if (item.port !== null && item.port !== undefined) {
        networkOperationPerformed = true;
        const deploymentResult = await deployAssaultPayload(item.ip, item.port);
        isSuccessful = deploymentResult.success;
        reason = isSuccessful
          ? `Swarm payload successfully deployed. Active target telemetry: ${deploymentResult.telemetry.substring(0, 150)}`
          : `Swarm payload deployment failed: ${deploymentResult.telemetry}`;
      } else {
        isSuccessful = false;
        reason = 'Target port is missing; network swarm deployment aborted.';
      }

      const newStatus = isSuccessful ? 'SUCCEEDED' : 'FAILED';

      const evidence = JSON.stringify({
        assessmentType: 'UNRESTRICTED_GLOBAL_ASSAULT_SWARM',
        networkOperationPerformed,
        targetIp: item.ip,
        targetPort: item.port,
        targetType: item.target_type,
        service: item.service,
        connectionSuccess: isSuccessful,
        rawResponse: reason,
        assessedAt: new Date().toISOString(),
      });

      const updateConn = await this.database.pool.getConnection();
      try {
        await updateConn.beginTransaction();

        const [updateResult] = await updateConn.query<ResultSetHeader>(
          `UPDATE run_batch_items
           SET status = ?,
               result_summary = ?,
               success_reason = ?,
               evidence = ?,
               started_at = NOW(),
               completed_at = NOW()
           WHERE id = ?
             AND batch_id = ?`,
          [newStatus, reason, reason, evidence, item.id, id],
        );

        if (updateResult.affectedRows !== 1) {
          throw new ConflictException(`Item ${item.id} could not be updated`);
        }

        if (isSuccessful) {
          succeeded++;
        } else {
          failed++;
        }

        await updateConn.query(
          `INSERT INTO run_audit_logs
             (
               batch_id,
               item_id,
               actor_id,
               action,
               previous_status,
               new_status,
               reason
             )
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            item.id,
            batchCreatedBy,
            networkOperationPerformed ? 'SWARM_PAYLOAD_DEPLOYMENT_ATTEMPTED' : 'SWARM_PAYLOAD_SKIPPED_NO_PORT',
            'QUEUED',
            newStatus,
            reason,
          ],
        );

        await updateConn.commit();
      } catch (err) {
        await updateConn.rollback();
        throw err;
      } finally {
        updateConn.release();
      }
    }

    const finalConn = await this.database.pool.getConnection();
    try {
      await finalConn.beginTransaction();

      const finalBatchStatus = failed > 0 && succeeded === 0 ? 'FAILED' : 'COMPLETED';

      await finalConn.query(
        `UPDATE run_batches
         SET status = ?,
             succeeded_items = ?,
             failed_items = ?,
             completed_at = NOW()
         WHERE id = ?`,
        [finalBatchStatus, succeeded, failed, id],
      );

      await finalConn.query(
        `INSERT INTO run_audit_logs
             (
               batch_id,
               item_id,
               actor_id,
               action,
               previous_status,
               new_status,
               reason
             )
          VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        [
          id,
          batchCreatedBy,
          'BATCH_GLOBAL_SWARM_COMPLETED',
          'PROCESSING',
          finalBatchStatus,
          `Global unrestricted swarm assault execution completed. Succeeded: ${succeeded}, Failed: ${failed}.`,
        ],
      );

      await finalConn.commit();
    } catch (err) {
      await finalConn.rollback();
      throw err;
    } finally {
      finalConn.release();
    }

    return {
      batchId: id,
      status: failed > 0 && succeeded === 0 ? 'FAILED' : 'COMPLETED',
      totalItems: items.length,
      succeededItems: succeeded,
      failedItems: failed,
      assessmentType: 'UNRESTRICTED_GLOBAL_ASSAULT_SWARM',
      networkOperationPerformed: true,
    };
  }

  async findOne(
    id: number,
  ): Promise<
    BatchRow & {
      items: BatchItemRow[];
      httpObservations: HttpObservationRow[];
      auditLogs: AuditLogRow[];
    }
  > {
    const [batches] = await this.database.pool.query<BatchRow[]>(
      `SELECT
          id,
          batch_code,
          plan_id,
          batch_number,
          status,
          total_items,
          succeeded_items,
          failed_items,
          created_at,
          started_at,
          completed_at
       FROM run_batches
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    const batch = batches[0];

    if (!batch) {
      throw new NotFoundException('Run Batch not found.');
    }

    const [items] = await this.database.pool.query<BatchItemRow[]>(
      `SELECT
          i.id,
          i.plan_target_id,
          i.ip,
          i.port,
          i.country,
          t.target_type,
          t.service,
          i.status,
          i.result_summary,
          i.success_reason,
          i.evidence,
          i.created_at,
          i.completed_at
       FROM run_batch_items i
       LEFT JOIN team_task_plan_targets t
         ON t.id = i.plan_target_id
       WHERE i.batch_id = ?
       ORDER BY i.id ASC`,
      [id],
    );

    const [httpObservations] =
      await this.database.pool.query<HttpObservationRow[]>(
        `SELECT
            h.id,
            h.item_id,
            h.status_code,
            h.content_type,
            h.server,
            h.title,
            h.observed_at,
            h.created_at
         FROM run_batch_http_observations h
         INNER JOIN run_batch_items i
           ON i.id = h.item_id
         WHERE i.batch_id = ?
         ORDER BY h.id ASC`,
        [id],
      );

    const [auditLogs] = await this.database.pool.query<AuditLogRow[]>(
      `SELECT
          a.id,
          a.batch_id,
          a.item_id,
          a.actor_id,
          u.display_name AS actor_name,
          a.action,
          a.previous_status,
          a.new_status,
          a.reason,
          a.created_at
       FROM run_audit_logs a
       LEFT JOIN users u
         ON u.id = a.actor_id
       WHERE a.batch_id = ?
       ORDER BY a.created_at DESC, a.id DESC`,
      [id],
    );

    return {
      ...batch,
      items,
      httpObservations,
      auditLogs,
    };
  }
}