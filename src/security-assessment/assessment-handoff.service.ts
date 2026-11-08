import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import type {
  RowDataPacket,
  ResultSetHeader,
} from 'mysql2';

import { DatabaseService } from '../database/database.service.js';
import type { AssessmentHandoffDto } from './dto/assessment-handoff.dto.js';

interface RunRow extends RowDataPacket {
  id: number;
  experiment_id: number;
  status: string;
}

interface AssessmentRow extends RowDataPacket {
  id: number;
  run_id: number;
  status: string;
}

interface Inventory {
  hosts: Record<string, unknown>[];
  services: Record<string, unknown>[];
  configurations: Record<string, unknown>[];
  permissions: Record<string, unknown>[];
}

interface HandoffPayload {
  status?: string;
  inventory?: Record<string, unknown>;
  findings?: unknown[];
  summary?: unknown;
  metrics?: Record<string, unknown>;
}

@Injectable()
export class AssessmentHandoffService {
  constructor(private readonly database: DatabaseService) {}

  async handleRunCompletion(runId: number, payload: HandoffPayload) {
    // 1. Validate run ID and payload structure
    if (!Number.isSafeInteger(runId) || runId <= 0) {
      throw new BadRequestException('Invalid run ID.');
    }

    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Invalid handoff payload.');
    }

    // 2. Verify the actual experiment run status from database
    const [runs] = await this.database.pool.execute<RunRow[]>(
      `SELECT id, experiment_id, status
         FROM experiment_runs
         WHERE id = ?
         LIMIT 1`,
      [runId],
    );

    const run = runs[0];

    if (!run) {
      throw new NotFoundException(`Experiment run ${runId} was not found.`);
    }

    if (run.status.toLowerCase() !== 'succeeded') {
      throw new ConflictException(
        `Run ${runId} is not completed successfully.`,
      );
    }

    if (
      payload.status !== undefined &&
      (typeof payload.status !== 'string' ||
        payload.status.toLowerCase() !== 'succeeded')
    ) {
      throw new BadRequestException(
        'Payload run status does not indicate success.',
      );
    }

    // 3. Find the assessment for this run — or AUTO-CREATE an UNAPPROVED one so
    //    the engine can hand off (receive) results even before a human starts.
    //    Auto-created assessments have NO session, so nothing can run until a
    //    human approves (the single execution gate in TaskRunnerService).
    const findAssessment = async () => {
      const [rows] = await this.database.pool.execute<AssessmentRow[]>(
        `SELECT id, run_id, status
           FROM security_assessments
           WHERE run_id = ?
           ORDER BY id DESC
           LIMIT 1`,
        [runId],
      );
      return rows[0];
    };

    let assessment = await findAssessment();

    if (!assessment) {
      const [owners] = await this.database.pool.execute<RowDataPacket[]>(
        `SELECT id FROM users ORDER BY id ASC LIMIT 1`,
      );
      const ownerId = owners[0]?.id as number | undefined;
      if (!ownerId) {
        throw new ConflictException(
          'No user exists to own an auto-created assessment.',
        );
      }
      await this.database.pool.execute<ResultSetHeader>(
        `INSERT INTO security_assessments
           (run_id, created_by, title, target_reference, scope_snapshot, status)
         VALUES (?, ?, ?, ?, '{}', 'access_verified')`,
        [runId, ownerId, `Engine run #${runId}`, `run:${runId}`],
      );
      assessment = await findAssessment();
    }

    if (!assessment) {
      throw new ConflictException(
        `Could not create or find an assessment for run ${runId}.`,
      );
    }

    if (assessment.run_id !== run.id) {
      throw new ConflictException(
        'Assessment and experiment run do not match.',
      );
    }

    if (
      ['completed', 'cancelled', 'revoked'].includes(
        assessment.status.toLowerCase(),
      )
    ) {
      throw new ConflictException('Assessment is not accepting new handoffs.');
    }

    // 4. Normalize inventory and findings data
    const inventory = this.normalizeInventory(payload.inventory);

    const findings = this.normalizeFindings(payload.findings);

    const snapshot = {
      inventory,
      findings,
      runResult: {
        runId,
        experimentId: run.experiment_id,
        summary: this.normalizeSummary(payload.summary),
        metrics: this.normalizeObject(payload.metrics),
        receivedAt: new Date().toISOString(),
      },
    };

    // 5. Save snapshot and audit record atomically without fabricating sessions
    const connection = await this.database.pool.getConnection();

    try {
      await connection.beginTransaction();

      const [lockedRows] = await connection.execute<AssessmentRow[]>(
        `SELECT id, run_id, status
           FROM security_assessments
           WHERE id = ?
           FOR UPDATE`,
        [assessment.id],
      );

      const lockedAssessment = lockedRows[0];

      if (!lockedAssessment) {
        throw new NotFoundException('Assessment no longer exists.');
      }

      if (
        ['completed', 'cancelled', 'revoked'].includes(
          lockedAssessment.status.toLowerCase(),
        )
      ) {
        throw new ConflictException(
          'Assessment is not accepting new handoffs.',
        );
      }

      const [updateResult] =
  await connection.execute<ResultSetHeader>(
        `UPDATE security_assessments
   SET scope_snapshot = ?,
       updated_at = CURRENT_TIMESTAMP
   WHERE id = ? AND run_id = ?`,
        [JSON.stringify(snapshot), assessment.id, runId],
      );

      if (updateResult.affectedRows !== 1) {
        throw new ConflictException(
          'Assessment snapshot could not be updated.',
        );
      }

      await connection.execute(
        `INSERT INTO security_assessment_audit_logs
         (
           assessment_id,
           actor_user_id,
           action,
           entity_type,
           entity_id,
           details
         )
         VALUES (?, NULL, ?, ?, ?, ?)`,
        [
          assessment.id,
          'engine.run_handoff_received',
          'experiment_run',
          runId,
          JSON.stringify({
            source: 'agi-engine',
            runStatus: run.status,
            inventoryCounts: {
              hosts: inventory.hosts.length,
              services: inventory.services.length,
              configurations: inventory.configurations.length,
              permissions: inventory.permissions.length,
            },
            findingsReceived: findings.length,
            sessionGenerated: false,
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

    return {
      accepted: true,
      runId,
      assessmentId: assessment.id,
      runStatus: run.status,
      findingsReceived: findings.length,
      sessionGenerated: false,
    };
  }

  private normalizeInventory(
    input: Record<string, unknown> | undefined,
  ): Inventory {
    const source = input ?? {};

    return {
      hosts: this.objectArray(source['hosts']),
      services: this.objectArray(source['services']),
      configurations: this.objectArray(source['configurations']),
      permissions: this.objectArray(source['permissions']),
    };
  }

  private normalizeFindings(
    input: unknown[] | undefined,
  ): Record<string, unknown>[] {
    if (!Array.isArray(input)) {
      return [];
    }

    return input.filter((item): item is Record<string, unknown> =>
      this.isObject(item),
    );
  }

  private objectArray(input: unknown): Record<string, unknown>[] {
    if (!Array.isArray(input)) {
      return [];
    }

    return input.filter((item): item is Record<string, unknown> =>
      this.isObject(item),
    );
  }

  private normalizeObject(input: unknown): Record<string, unknown> {
    return this.isObject(input) ? input : {};
  }

  private normalizeSummary(input: unknown): string | Record<string, unknown> {
    if (typeof input === 'string') {
      return input;
    }

    if (this.isObject(input)) {
      return input;
    }

    return '';
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
