import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PoolConnection } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Logs only the error type plus a safe code/status. The raw message is never
// logged because upstream and database errors can carry secrets.
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

@Injectable()
export class RunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RunnerService.name);
  private anthropic: Anthropic | null = null;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(private readonly db: DatabaseService) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  onModuleInit() {
    if (process.env.RUNNER_ENABLED === 'true') {
      this.logger.log('Runner service initialized and enabled.');
      this.timer = setInterval(() => {
        void this.handleQueue();
      }, 5000);
    } else {
      this.logger.log('Runner service is disabled (RUNNER_ENABLED != true).');
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async handleQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    if (process.env.RUNNER_ENABLED !== 'true') {
      return;
    }

    if (!this.anthropic) {
      this.logger.warn('Runner enabled but ANTHROPIC_API_KEY is missing.');
      return;
    }

    this.isProcessing = true;
    let connection: PoolConnection | null = null;

    try {
      // Check hourly run limit constraint (RUNNER_MAX_RUNS_PER_HOUR)
      const maxRunsPerHour = parseInt(
        process.env.RUNNER_MAX_RUNS_PER_HOUR || '20',
        10,
      );
      const [countRows] = await this.db.pool.query(
        `SELECT COUNT(*) as count FROM experiment_runs WHERE started_at >= NOW() - INTERVAL 1 HOUR AND status IN ('running', 'succeeded', 'failed')`,
      );
      const recentRunsCount =
        (countRows as Array<{ count: number }>)[0]?.count || 0;
      if (recentRunsCount >= maxRunsPerHour) {
        this.logger.warn(
          `Runner hourly limit reached (${recentRunsCount}/${maxRunsPerHour}). Skipping tick.`,
        );
        return;
      }

      connection = await this.db.pool.getConnection();
      await connection.beginTransaction();

      // Atomic select and lock using SKIP LOCKED locking only experiment_runs
      const [runs] = await connection.execute(
        `SELECT r.id, r.experiment_id, r.params, e.agent_id, a.model, a.status as agent_status 
         FROM experiment_runs r 
         JOIN experiments e ON r.experiment_id = e.id 
         LEFT JOIN agents a ON e.agent_id = a.id 
         WHERE r.status = 'queued' 
           AND (a.status IS NULL OR a.status = 'idle')
         ORDER BY r.created_at ASC, r.id ASC 
         LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
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

      // Validate agent and model existence
      if (!run.agent_id || !run.model) {
        await connection.execute(
          `UPDATE experiment_runs SET status = 'failed', finished_at = NOW(), error_message = ? WHERE id = ?`,
          ['Run failed: Missing agent or model configuration', run.id],
        );
        await connection.commit();
        return;
      }

      // Mark run as running and agent as running
      await connection.execute(
        `UPDATE experiment_runs SET status = 'running', started_at = NOW() WHERE id = ?`,
        [run.id],
      );
      await connection.execute(
        `UPDATE agents SET status = 'running', updated_at = NOW() WHERE id = ?`,
        [run.agent_id],
      );

      await connection.commit();

      connection.release();
      connection = null;

      // Execute external model call outside transaction
      await this.executeRun(run.id, run.agent_id, run.model, run.params);
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch (rbErr) {
          this.logger.error(
            `Failed to rollback transaction [${describeError(rbErr)}]`,
          );
        }
      }
      this.logger.error(`Error in runner queue tick [${describeError(error)}]`);
    } finally {
      if (connection) {
        connection.release();
      }
      this.isProcessing = false;
    }
  }

  private async executeRun(
    runId: string,
    agentId: string,
    model: string,
    params: unknown,
  ): Promise<void> {
    const startTime = Date.now();
    let status = 'succeeded';
    let errorMessage: string | null = null;
    let outputText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      let prompt = 'Execute experiment';
      if (params) {
        if (typeof params === 'string') {
          try {
            const parsed: unknown = JSON.parse(params);
            if (isRecord(parsed) && typeof parsed.prompt === 'string') {
              prompt = parsed.prompt.slice(0, 4000);
            }
          } catch {
            // use default prompt if parse fails
          }
        } else if (isRecord(params)) {
          if (typeof params.prompt === 'string') {
            prompt = params.prompt.slice(0, 4000);
          }
        }
      }

      const response = await this.anthropic!.messages.create({
        model: model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      outputText = response.content
        .filter((c): c is Anthropic.TextBlock => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .slice(0, 8000);

      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;
    } catch (err: unknown) {
      status = 'failed';
      errorMessage = 'Model execution failed securely';
      this.logger.error(
        `Model execution error for run ${runId} [${describeError(err)}]`,
      );
    }

    const latencyMs = Date.now() - startTime;
    const metricsObj = {
      latencyMs,
      inputTokens,
      outputTokens,
      output: outputText,
    };

    try {
      // Update run status and metrics
      await this.db.pool.query(
        `UPDATE experiment_runs SET status = ?, finished_at = NOW(), error_message = ?, metrics = ? WHERE id = ?`,
        [status, errorMessage, JSON.stringify(metricsObj), runId],
      );

      // Reset agent status back to idle (even if failed, so agent isn't stuck forever)
      await this.db.pool.query(
        `UPDATE agents SET status = 'idle', updated_at = NOW() WHERE id = ? AND status NOT IN ('paused', 'retired')`,
        [agentId],
      );

      // Write agent log
      const logLevel = status === 'succeeded' ? 'info' : 'error';
      const logMessage =
        status === 'succeeded'
          ? `Run completed successfully in ${latencyMs}ms`
          : `Run failed`;
      await this.db.pool.query(
        `INSERT INTO agent_logs (agent_id, run_id, level, message, context, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          agentId,
          runId,
          logLevel,
          logMessage,
          JSON.stringify({ inputTokens, outputTokens }),
        ],
      );
    } catch (dbErr) {
      this.logger.error(
        `Failed to persist run results for ${runId}, attempting recovery [${describeError(dbErr)}]`,
      );
      try {
        await this.db.pool.query(
          `UPDATE experiment_runs SET status = 'failed', finished_at = NOW(), error_message = ? WHERE id = ? AND status = 'running'`,
          ['Persistence failure recovery', runId],
        );
        await this.db.pool.query(
          `UPDATE agents SET status = 'idle', updated_at = NOW() WHERE id = ? AND status NOT IN ('paused', 'retired')`,
          [agentId],
        );
      } catch (recoveryErr) {
        this.logger.error(
          `Recovery failed for run ${runId} [${describeError(recoveryErr)}]`,
        );
      }
    }
  }
}
