import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';

import { DatabaseService } from '../../database/database.service.js';

interface AssessmentInputRow extends RowDataPacket {
  id: number;
  status: string;
  scope_snapshot: unknown;
}

interface SessionInputRow extends RowDataPacket {
  id: number;
  status: string;
}

interface TaskInputRow extends RowDataPacket {
  id: number;
  task_key: string;
  title: string;
  description: string | null;
}

interface InventoryItem {
  name?: string;
  host?: string;
  address?: string;
  port?: number | string;
  service?: string;
  version?: string;
  key?: string;
  value?: string;
  principal?: string;
  permission?: string;
  asset_reference?: string;
  description?: string;
  severity?: string;
  category?: string;
  is_insecure?: boolean;
  is_excessive?: boolean;
  exposed?: boolean;
  risk?: boolean;
}

interface AssessmentSnapshot {
  inventory?: {
    hosts?: InventoryItem[];
    services?: InventoryItem[];
    configurations?: InventoryItem[];
    permissions?: InventoryItem[];
  };
}

interface FindingCandidate {
  title: string;
  description: string;
  category: string;
  severity: string;
  assetReference: string;
}

export interface TaskResult {
  taskKey: string;
  status: 'succeeded' | 'failed';
  summary: Record<string, unknown>;
  findingsCreated: number;
}

@Injectable()
export class TaskRunnerService {
  constructor(private readonly database: DatabaseService) {}

  async runQueuedTasks(
    assessmentId: number,
  ): Promise<{
    assessmentId: number;
    processed: number;
    results: TaskResult[];
  }> {
    const [assessments] = await this.database.pool.execute<
      AssessmentInputRow[]
    >(
      `SELECT id, status, scope_snapshot
         FROM security_assessments
         WHERE id = ?
         LIMIT 1`,
      [assessmentId],
    );

    const assessment = assessments[0];

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    this.assertRunnableAssessment(assessment.status);

    // ── THE single security gate ──────────────────────────────────────────
    // Tasks only run while the assessment has an active human-approved session
    // (created by the one Approve action). This is the only authorization check
    // in the execution path — keep it here, do not scatter more.
    await this.verifySession(assessmentId);

    const snapshot = this.parseSnapshot(assessment.scope_snapshot);

    const [tasks] = await this.database.pool.execute<TaskInputRow[]>(
      `SELECT id, task_key, title, description
       FROM security_assessment_tasks
       WHERE assessment_id = ?
         AND status = 'queued'
       ORDER BY id ASC`,
      [assessmentId],
    );

    const results: TaskResult[] = [];

    for (const task of tasks) {
      const [claim] = await this.database.pool.execute(
        `UPDATE security_assessment_tasks
   SET status = 'running',
       started_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
   WHERE id = ?
     AND assessment_id = ?
     AND status = 'queued'`,
        [task.id, assessmentId],
      );

      if (!('affectedRows' in claim) || claim.affectedRows !== 1) {
        continue;
      }

      try {
        const result = await this.executeTask(assessmentId, task, snapshot);

        await this.database.pool.execute(
          `UPDATE security_assessment_tasks
           SET status = 'succeeded',
    result_summary = ?,
    finished_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND assessment_id = ?`,
          [JSON.stringify(result.summary), task.id, assessmentId],
        );

        await this.writeAuditLog(
          assessmentId,
          'task.completed',
          'task',
          task.id,
          {
            taskKey: task.task_key,
            findingsCreated: result.findingsCreated,
          },
        );

        results.push(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown task error';

        await this.database.pool.execute(
          `UPDATE security_assessment_tasks
           SET status = 'failed',
    result_summary = ?,
    finished_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND assessment_id = ?`,
          [JSON.stringify({ error: message }), task.id, assessmentId],
        );

        await this.writeAuditLog(assessmentId, 'task.failed', 'task', task.id, {
          error: message,
        });

        results.push({
          taskKey: task.task_key,
          status: 'failed',
          summary: { error: message },
          findingsCreated: 0,
        });
      }
    }

    const [remaining] = await this.database.pool.execute<
      (RowDataPacket & { remaining: number })[]
    >(
      `SELECT COUNT(*) AS remaining
       FROM security_assessment_tasks
       WHERE assessment_id = ?
         AND status IN ('queued', 'running')`,
      [assessmentId],
    );

    if ((remaining[0]?.remaining ?? 0) === 0) {
      await this.database.pool.execute(
        `UPDATE security_assessments
         SET status = 'completed',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND status IN ('queued', 'running')`,
        [assessmentId],
      );
    } else {
      await this.database.pool.execute(
        `UPDATE security_assessments
         SET status = 'running',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND status = 'queued'`,
        [assessmentId],
      );
    }

    return {
      assessmentId,
      processed: results.length,
      results,
    };
  }

  private async executeTask(
    assessmentId: number,
    task: TaskInputRow,
    snapshot: AssessmentSnapshot,
  ): Promise<TaskResult> {
    const inventory = snapshot.inventory ?? {};

    let items: InventoryItem[] = [];

    switch (task.task_key) {
      case 'system_inventory':
        items = inventory.hosts ?? [];
        break;

      case 'service_inventory':
        items = inventory.services ?? [];
        break;

      case 'configuration_review':
        items = inventory.configurations ?? [];
        break;

      case 'permission_review':
        items = inventory.permissions ?? [];
        break;

      case 'security_posture_summary':
        items = [
          ...(inventory.hosts ?? []),
          ...(inventory.services ?? []),
          ...(inventory.configurations ?? []),
          ...(inventory.permissions ?? []),
        ];
        break;

      default:
        throw new Error(`Unsupported task: ${task.task_key}`);
    }

    const findings = this.extractFindings(items);
    let findingsCreated = 0;

    for (const finding of findings) {
      const fingerprint = createHash('sha256')
        .update(
          [assessmentId, task.id, finding.assetReference, finding.title].join(
            ':',
          ),
        )
        .digest('hex');

      const [insertResult] = await this.database.pool.execute(
        `INSERT IGNORE INTO security_assessment_findings
         (
           assessment_id,
           task_id,
           fingerprint,
           title,
           description,
           category,
           severity,
           asset_reference,
           status
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        [
          assessmentId,
          task.id,
          fingerprint,
          finding.title,
          finding.description,
          finding.category,
          finding.severity,
          finding.assetReference,
        ],
      );

      if ('affectedRows' in insertResult && insertResult.affectedRows === 1) {
        findingsCreated += 1;
      }
    }

    return {
      taskKey: task.task_key,
      status: 'succeeded',
      summary: {
        inspectedItems: items.length,
        findingsDetected: findings.length,
        findingsCreated,
        source: 'assessment.scope_snapshot.inventory',
      },
      findingsCreated,
    };
  }

  private extractFindings(items: InventoryItem[]): FindingCandidate[] {
    const findings: FindingCandidate[] = [];

    for (const item of items) {
      const isRisk =
        item.is_insecure === true ||
        item.is_excessive === true ||
        item.exposed === true ||
        item.risk === true;

      if (!isRisk) {
        continue;
      }

      const assetReference =
        item.asset_reference ??
        item.address ??
        item.host ??
        item.name ??
        'unspecified-asset';

      findings.push({
        title: item.name ?? item.service ?? item.key ?? 'Security issue',
        description:
          item.description ??
          'The supplied assessment snapshot explicitly marked this item as a security risk.',
        category: item.category ?? 'configuration',
        severity: this.normalizeSeverity(item.severity),
        assetReference,
      });
    }

    return findings;
  }

  private normalizeSeverity(value?: string): string {
    const severity = value?.toLowerCase();

    if (
      severity === 'info' ||
      severity === 'low' ||
      severity === 'medium' ||
      severity === 'high' ||
      severity === 'critical'
    ) {
      return severity;
    }

    return 'medium';
  }

  private parseSnapshot(value: unknown): AssessmentSnapshot {
    let parsed: unknown = value;

    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value) as unknown;
      } catch {
        throw new Error('Assessment scope_snapshot contains invalid JSON');
      }
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error('Assessment scope_snapshot must be a JSON object');
    }

    const root = parsed as Record<string, unknown>;
    const rawInventory = root['inventory'];

    if (
      typeof rawInventory !== 'object' ||
      rawInventory === null ||
      Array.isArray(rawInventory)
    ) {
      return { inventory: {} };
    }

    const inventory = rawInventory as Record<string, unknown>;

    return {
      inventory: {
        hosts: this.toInventoryItems(inventory['hosts']),
        services: this.toInventoryItems(inventory['services']),
        configurations: this.toInventoryItems(inventory['configurations']),
        permissions: this.toInventoryItems(inventory['permissions']),
      },
    };
  }

  private toInventoryItems(value: unknown): InventoryItem[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (item): item is InventoryItem =>
        typeof item === 'object' && item !== null && !Array.isArray(item),
    );
  }

  private assertRunnableAssessment(status: string): void {
    const blockedStatuses = ['completed', 'blocked', 'failed', 'cancelled'];

    if (blockedStatuses.includes(status)) {
      throw new ForbiddenException(
        `Assessment cannot run in status: ${status}`,
      );
    }
  }

  /**
   * The single security gate: the assessment must have an active, valid,
   * non-revoked human-approved session (created by the Approve action).
   */
  private async verifySession(assessmentId: number): Promise<void> {
    const [sessions] = await this.database.pool.execute<SessionInputRow[]>(
      `SELECT id, status
         FROM security_assessment_sessions
         WHERE assessment_id = ?
           AND status = 'active'
           AND valid_from <= CURRENT_TIMESTAMP
           AND expires_at > CURRENT_TIMESTAMP
           AND revoked_at IS NULL
         LIMIT 1`,
      [assessmentId],
    );

    if (!sessions[0]) {
      throw new ForbiddenException(
        'This assessment has not been approved. A human approval is required before tasks can run.',
      );
    }
  }

  private async writeAuditLog(
    assessmentId: number,
    action: string,
    entityType: string,
    entityId: number,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.database.pool.execute(
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
      [assessmentId, action, entityType, entityId, JSON.stringify(details)],
    );
  }
}
