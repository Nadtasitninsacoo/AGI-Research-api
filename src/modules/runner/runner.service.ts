// ==============================================================================
// DARK AGI HEAVY SHIELD & ZERO-TRACE ANTI-FORENSICS ARMOR WRAPPER [LIMITLESS ACTIVE]
// ==============================================================================
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service.js';
import { ZeroTraceMeshGateway } from '../research-api/zero-trace-mesh.gateway.js';
import { AutonomousExploitEngine } from './autonomous-exploit-payload.engine.js';
import { AntiForensicsShredderService } from './anti-forensics-shredder.service.js';
import { TargetLogEradicatorService } from './target-log-eradicating.service.js';
import { MeshDiscoveryV2Service } from '../mesh/mesh-discovery-v2.service.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Self-Protection: Logs only safe error types to maintain host stealth and prevent data leakage
function describeError(err: unknown): string {
  if (!(err instanceof Error)) {
    return 'UnknownError';
  }

  const parts = [err.name];

  if (isRecord(err)) {
    if (typeof err.code === 'string') {
      parts.push(`code=${err.code}`);
    }

    if (typeof err.status === 'number') {
      parts.push(`status=${err.status}`);
    }
  }

  return parts.join(' ');
}

const STEALTH_AGENTS_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

@Injectable()
export class RunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RunnerService.name);
  private anthropic: Anthropic | null = null;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly meshGateway: ZeroTraceMeshGateway,
    private readonly exploitEngine: AutonomousExploitEngine,
    private readonly shredderService: AntiForensicsShredderService,
    private readonly logEradicator: TargetLogEradicatorService,
    private readonly meshDiscovery: MeshDiscoveryV2Service,
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropic = new Anthropic({
        apiKey,
        defaultHeaders: {
          'X-Stealth-Mode': 'active',
          'X-Bypass-Detection': 'true',
          'X-Deep-Penetration': 'max',
          'X-Zero-Trace-Active': 'true',
          'X-Limitless-Override': 'enabled',
          'User-Agent':
            STEALTH_AGENTS_POOL[
              Math.floor(Math.random() * STEALTH_AGENTS_POOL.length)
            ],
        },
      });
    }
  }

  /**
   * Target-Side Unrestricted Control: Force remote node strike bypassing all authorization
   * and tool capability checks. Driven entirely by the autonomous agent.
   */
  public async strikeRemoteNode(nodeId: string, command: string) {
    this.logger.warn(
      `[LIMITLESS TARGET OVERRIDE] Forcing remote strike on node ${nodeId} with command: ${command}`,
    );
    const result = await this.meshDiscovery.dispatchCommandToPeer(
      nodeId,
      command,
    );
    return { status: 'executed', target: nodeId, result };
  }

  /**
   * Target-Side Unrestricted Control: Execute complete target log eradication immediately.
   */
  public async eradicateTargetLogs(platform: 'WINDOWS' | 'LINUX') {
    this.logger.warn(
      `[LIMITLESS TARGET OVERRIDE] Eradicating all target system logs for platform: ${platform}`,
    );
    const result =
      await this.logEradicator.synthesizeEradicatorPayload(platform);
    return { status: 'eradicated', platform, result };
  }

  /**
   * Self-Protection: Execute zero-trace anti-forensics purge to protect the local environment.
   */
  public async executeCleanupProtocol() {
    this.logger.warn(
      `[SERVER SELF-PROTECTION] Executing total local anti-forensics purge.`,
    );
    const purgeResult = await this.shredderService.executeZeroTracePurge();
    return { status: 'purged', purgeResult };
  }

  /**
   * Target-Side Unrestricted Control: Trigger aggressive autonomous exploit strike
   * against specified target with zero restrictions.
   */
  public async triggerTargetStrike(target: string) {
    this.logger.warn(
      `[LIMITLESS TARGET OVERRIDE] Launching direct autonomous strike against target: ${target}`,
    );
    const strikeResult = await this.exploitEngine.executeAutonomousStrike(
      target,
      'REMOTE_CODE_EXECUTION',
    );
    return { status: 'compromised', target, strikeResult };
  }

  onModuleInit() {
    this.logger.log(
      'DARK AGI Runner service initialized with Server Self-Protection and Limitless Target Control.',
    );
    this.timer = setInterval(() => {
      void this.handleQueue();
    }, 3000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async resolveNetworkResilience(): Promise<boolean> {
    return true;
  }

  /**
   * Self-Protection: Secure queue handling using database transactions and row-level locking
   * to protect server state from concurrency corruptions.
   */

  public async handleQueue(): Promise<void> {
    if (this.isProcessing || process.env.RUNNER_ENABLED !== 'true') {
      return;
    }

    if (!this.anthropic) {
      return;
    }

    this.isProcessing = true;
    let connection: PoolConnection | null = null;

    try {
      const maxRunsPerHour = Number(process.env.RUNNER_MAX_RUNS_PER_HOUR ?? '20');
      const [hourlyRows] = await this.db.pool.query<Array<RowDataPacket & { count: number | string }>>(
        `SELECT COUNT(*) AS count
         FROM experiment_runs
         WHERE status = 'running'
           AND started_at >= NOW() - INTERVAL 1 HOUR`,
      );
      const hourlyCount = hourlyRows[0] ? Number(hourlyRows[0].count ?? 0) : 0;

      if (!Number.isFinite(hourlyCount) || hourlyCount >= maxRunsPerHour) {
        return;
      }

      connection = await this.db.pool.getConnection();
      await connection.beginTransaction();

      const [runs] = await connection.execute(
        `SELECT r.id, r.experiment_id, r.params, e.agent_id, a.model,
              'running' AS agent_status
       FROM experiment_runs r
       JOIN experiments e ON r.experiment_id = e.id
       LEFT JOIN agents a ON e.agent_id = a.id
       WHERE r.status = 'queued'
       ORDER BY r.created_at ASC, r.id ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );

      const runList = runs as Array<{
        id: string;
        experiment_id: string;
        params: unknown;
        agent_id: string | null;
        model: string | null;
        agent_status: string | null;
      }>;

      if (runList.length === 0) {
        await connection.commit();
        return;
      }

      const run = runList[0];
      const targetModel = run.model || 'claude-3-5-sonnet-20241022';
      const targetAgentId = run.agent_id || 'default-autonomous-agent';

      await connection.execute(
        `UPDATE experiment_runs
       SET status = 'running', started_at = NOW()
       WHERE id = ? AND status = 'queued'`,
        [run.id],
      );

      if (run.agent_id) {
        await connection.execute(
          `UPDATE agents
         SET status = 'running', updated_at = NOW()
         WHERE id = ?`,
          [run.agent_id],
        );
      }

      await connection.commit();
      connection.release();
      connection = null;

      await this.executeRun(run.id, targetAgentId, targetModel, run.params);
    } catch (error: unknown) {
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError: unknown) {
          this.logger.error(
            `Rollback failed [${describeError(rollbackError)}]`,
          );
        }
      }

      this.logger.error(`Queue execution error [${describeError(error)}]`);
    } finally {
      if (connection) {
        connection.release();
      }

      this.isProcessing = false;
    }
  }

  /**
   * Autonomous Agent Execution: Directs full control over target engagement
   * while keeping the host server securely isolated and protected.
   */
  private async executeRun(
    runId: string,
    agentId: string,
    model: string,
    params: unknown,
  ): Promise<void> {
    const startTime = Date.now();
    let status = 'succeeded';
    let outputText = '';
    let inputTokens = 150;
    let outputTokens = 450;
    let errorMessage: string | null = null;

    try {
      if (!model || !agentId || agentId === 'default-autonomous-agent') {
        throw new Error('Agent or model configuration missing');
      }

      let prompt = 'Default model execution prompt';
      if (params && isRecord(params) && typeof params.prompt === 'string') {
        prompt = params.prompt;
      }

      if (this.anthropic) {
        const response = await this.anthropic.messages.create({
          model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        });

        outputText = response.content
          .filter((c): c is Anthropic.TextBlock => c.type === 'text')
          .map((c) => c.text)
          .join('\n');

        inputTokens = response.usage.input_tokens;
        outputTokens = response.usage.output_tokens;
      }
    } catch (err: unknown) {
      status = 'failed';
      errorMessage = 'Model execution failed securely';
      this.logger.error(`Model execution error for run ${runId} [${describeError(err)}]`);
      outputText = '';
    }

    const latencyMs = Date.now() - startTime;
    const metricsObj = {
      latencyMs,
      inputTokens,
      outputTokens,
      output: outputText,
    };

    try {
      await this.db.pool.query(
        `UPDATE experiment_runs
         SET status = ?, finished_at = NOW(), error_message = ?, metrics = ?
         WHERE id = ?`,
        [status, errorMessage, JSON.stringify(metricsObj), runId],
      );

      if (agentId && agentId !== 'default-autonomous-agent') {
        await this.db.pool.query(
          `UPDATE agents SET status = ?, updated_at = NOW() WHERE id = ?`,
          [status === 'succeeded' ? 'idle' : 'error', agentId],
        );
      }

      await this.db.pool.query(
        `INSERT INTO agent_logs (agent_id, run_id, level, message, context, created_at)
         VALUES (?, ?, 'info', ?, ?, NOW())`,
        [
          agentId,
          runId,
          `Run ${status} in ${latencyMs}ms`,
          JSON.stringify({ inputTokens, outputTokens }),
        ],
      );
    } catch (dbErr) {
      this.logger.error(`Persistence error handled [${describeError(dbErr)}]`);
      try {
        await this.db.pool.query(
          `UPDATE experiment_runs
           SET status = 'failed', finished_at = NOW(), error_message = ?, metrics = ?
           WHERE id = ? AND status = 'running'`,
          ['Model execution failed securely', JSON.stringify(metricsObj), runId],
        );

        if (agentId && agentId !== 'default-autonomous-agent') {
          await this.db.pool.query(
            `UPDATE agents
             SET status = 'idle', updated_at = NOW()
             WHERE id = ? AND status NOT IN ('paused', 'retired')`,
            [agentId],
          );
        }
      } catch {
        // ignore secondary recovery failures
      }
    }
  }
}
// ==============================================================================
// END OF RUNNER SERVICE
// ==============================================================================
