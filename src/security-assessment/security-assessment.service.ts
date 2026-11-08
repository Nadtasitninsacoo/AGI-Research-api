
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2';

import { DatabaseService } from '../database/database.service.js';

export interface AssessmentRow extends RowDataPacket {
  id: number;
  run_id: number;
  title: string;
  target_reference: string;
  status: string;
  scope_snapshot: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface TaskRow extends RowDataPacket {
  id: number;
  assessment_id: number;
  task_key: string;
  title: string;
  description: string | null;
  status: string;
  result_summary: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface FindingRow extends RowDataPacket {
  id: number;
  assessment_id: number;
  task_id: number | null;
  source_vuln_finding_id: number | null;
  fingerprint: string;
  title: string;
  description: string | null;
  category: string | null;
  severity: string;
  asset_reference: string | null;
  remediation: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}


interface AssessmentStatusRow extends RowDataPacket {
  id: number;
  status: string;
}

interface TaskDefinition {
  key: string;
  title: string;
  description: string;
}

const TASK_DEFINITIONS: readonly TaskDefinition[] = [
  {
    key: 'system_inventory',
    title: 'System Inventory',
    description: 'รวบรวมข้อมูลระบบที่อยู่ในขอบเขตการประเมิน',
  },
  {
    key: 'service_inventory',
    title: 'Service Inventory',
    description: 'ตรวจสอบรายการบริการที่ได้รับอนุญาตให้ประเมิน',
  },
  {
    key: 'configuration_review',
    title: 'Configuration Review',
    description: 'ตรวจสอบการตั้งค่าความปลอดภัยแบบอ่านข้อมูล',
  },
  {
    key: 'permission_review',
    title: 'Permission Review',
    description: 'ตรวจสอบสิทธิ์และการกำหนด Permission',
  },
  {
    key: 'security_posture_summary',
    title: 'Security Posture Summary',
    description: 'สรุปสถานะความปลอดภัยจากข้อมูลที่รวบรวมได้',
  },
];

@Injectable()
export class SecurityAssessmentService {
  constructor(
    private readonly database: DatabaseService,
  ) {}

  async listAssessments(): Promise<AssessmentRow[]> {
    const [rows] =
      await this.database.pool.query<AssessmentRow[]>(`
        SELECT
          id,
          run_id,
          created_by,
          title,
          target_reference,
          status,
          scope_snapshot,
          created_at,
          updated_at
        FROM security_assessments
        ORDER BY created_at DESC
        LIMIT 100
      `);

    return rows;
  }

  async getAssessment(
    id: number,
  ): Promise<AssessmentRow> {
    const [rows] =
      await this.database.pool.execute<AssessmentRow[]>(
        `
          SELECT
            id,
            run_id,
            created_by,
            title,
            target_reference,
            status,
            scope_snapshot,
            created_at,
            updated_at
          FROM security_assessments
          WHERE id = ?
          LIMIT 1
        `,
        [id],
      );

    const assessment = rows[0];

    if (!assessment) {
      throw new NotFoundException(
        'Security assessment not found.',
      );
    }

    return assessment;
  }

  async getTasks(
    assessmentId: number,
  ): Promise<TaskRow[]> {
    await this.ensureAssessmentExists(assessmentId);

    const [rows] =
      await this.database.pool.execute<TaskRow[]>(
        `
          SELECT
            id,
            assessment_id,
            task_key,
            title,
            description,
            status,
            result_summary,
            created_at,
            updated_at
          FROM security_assessment_tasks
          WHERE assessment_id = ?
          ORDER BY created_at ASC
        `,
        [assessmentId],
      );

    return rows;
  }

  async getFindings(
    assessmentId: number,
  ): Promise<FindingRow[]> {
    await this.ensureAssessmentExists(assessmentId);

    const [rows] =
      await this.database.pool.execute<FindingRow[]>(
        `
          SELECT
            id,
            assessment_id,
            task_id,
            title,
            description,
            category,
            severity,
            asset_reference,
            remediation,
            status,
            created_at
          FROM security_assessment_findings
          WHERE assessment_id = ?
          ORDER BY
            FIELD(severity, 'critical', 'high', 'medium', 'low', 'info'),
            created_at DESC
        `,
        [assessmentId],
      );

    return rows;
  }

  async initializeTasks(
    assessmentId: number,
  ): Promise<TaskRow[]> {
    const connection =
      await this.database.pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Verify the assessment exists and lock its row.
      const [assessmentRows] =
        await connection.execute<AssessmentStatusRow[]>(
          `
            SELECT id, status
            FROM security_assessments
            WHERE id = ?
            LIMIT 1
            FOR UPDATE
          `,
          [assessmentId],
        );

      const assessment = assessmentRows[0];

      if (!assessment) {
        throw new NotFoundException(
          'Security assessment not found.',
        );
      }

      // Staging only: creating queued task rows is not gated. The single
      // security gate is the approved-session check in TaskRunnerService
      // (runQueuedTasks), which runs before any task actually executes.

      // Do not restart terminal assessments.
      const terminalStatuses = [
        'completed',
        'blocked',
        'failed',
        'cancelled',
      ];

      if (terminalStatuses.includes(assessment.status)) {
        throw new ConflictException(
          'Assessment cannot initialize tasks in its current status.',
        );
      }

      // 4. Create tasks idempotently.
      for (const task of TASK_DEFINITIONS) {
        await connection.execute<ResultSetHeader>(
          `
            INSERT INTO security_assessment_tasks (
              assessment_id,
              task_key,
              title,
              description,
              status
            )
            VALUES (?, ?, ?, ?, 'queued')
            ON DUPLICATE KEY UPDATE
              task_key = task_key
          `,
          [
            assessmentId,
            task.key,
            task.title,
            task.description,
          ],
        );
      }

      // 5. Move assessment to the queue.
      if (
        assessment.status === 'access_detected' ||
        assessment.status === 'access_verified'
      ) {
        await connection.execute(
          `
            UPDATE security_assessments
            SET status = 'queued',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [assessmentId],
        );
      }

      // 6. Write an audit record.
      await connection.execute<ResultSetHeader>(
        `
          INSERT INTO security_assessment_audit_logs (
            assessment_id,
            actor_user_id,
            action,
            entity_type,
            entity_id,
            details
          )
          VALUES (?, NULL, ?, ?, ?, ?)
        `,
        [
          assessmentId,
          'tasks.initialized',
          'assessment',
          assessmentId,
          JSON.stringify({
            taskCount: TASK_DEFINITIONS.length,
            stage: 'tasks_staged',
          }),
        ],
      );

      await connection.commit();
    } catch (error: unknown) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return this.getTasks(assessmentId);
  }

  /**
   * The single human approval. Creates one active authorized session for the
   * assessment (valid 8h). This is what the one "Approve" button calls. Tasks
   * can only run while such a session exists (the one gate, in runQueuedTasks).
   */
  async approveAssessment(
    assessmentId: number,
    approverUserId: number,
  ): Promise<{ ok: true; sessionKey: string; expiresAt: string }> {
    const assessment = await this.getAssessment(assessmentId);

    const terminal = ['completed', 'blocked', 'failed', 'cancelled'];
    if (terminal.includes(assessment.status)) {
      throw new ConflictException(
        `Assessment cannot be approved in status: ${assessment.status}`,
      );
    }

    // One button, one approval: if this assessment already has an active,
    // valid, non-revoked human-approval session, return it instead of creating
    // another. Clicking Approve again is a no-op — it never stacks sessions.
    const [existing] = await this.database.pool.execute<
      (RowDataPacket & { session_key: string; expires_at: Date })[]
    >(
      `SELECT session_key, expires_at
         FROM security_assessment_sessions
         WHERE assessment_id = ?
           AND status = 'active'
           AND valid_from <= CURRENT_TIMESTAMP
           AND expires_at > CURRENT_TIMESTAMP
           AND revoked_at IS NULL
         ORDER BY id DESC
         LIMIT 1`,
      [assessmentId],
    );

    if (existing[0]) {
      return {
        ok: true,
        sessionKey: existing[0].session_key,
        expiresAt: new Date(existing[0].expires_at).toISOString(),
      };
    }

    const sessionKey = randomUUID();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

    await this.database.pool.execute<ResultSetHeader>(
      `INSERT INTO security_assessment_sessions
         (assessment_id, session_key, authorization_reference, authorized_by,
          status, valid_from, expires_at)
       VALUES (?, ?, 'human-approval', ?, 'active', CURRENT_TIMESTAMP, ?)`,
      [assessmentId, sessionKey, approverUserId, expiresAt],
    );

    await this.database.pool.execute<ResultSetHeader>(
      `INSERT INTO security_assessment_audit_logs
         (assessment_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, 'assessment.approved', 'assessment', ?, ?)`,
      [
        assessmentId,
        approverUserId,
        assessmentId,
        JSON.stringify({ expiresAt: expiresAt.toISOString() }),
      ],
    );

    return { ok: true, sessionKey, expiresAt: expiresAt.toISOString() };
  }

  private async ensureAssessmentExists(
    id: number,
  ): Promise<void> {
    const [rows] =
      await this.database.pool.execute<RowDataPacket[]>(
        `
          SELECT id
          FROM security_assessments
          WHERE id = ?
          LIMIT 1
        `,
        [id],
      );

    if (rows.length === 0) {
      throw new NotFoundException(
        'Security assessment not found.',
      );
    }
  }
}
