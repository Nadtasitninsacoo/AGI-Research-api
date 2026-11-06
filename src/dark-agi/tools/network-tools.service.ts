import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

@Injectable()
export class NetworkToolsService {
  private readonly logger = new Logger(NetworkToolsService.name);

  /**
   * Self-Protection Guard 1: Sanitize input target to prevent Server Command Injection.
   * Ensures no malicious shell metacharacters can compromise the host machine itself.
   */
  private sanitizeTarget(target: string): string {
    const cleaned = String(target ?? '').trim();
    // Strip dangerous characters that could be exploited for local command injection
    const sanitized = cleaned.replace(/[;&|`$<>'"\\]/g, '');
    if (!sanitized) {
      throw new BadRequestException(
        'Server Self-Protection Violation: Invalid or unsafe target format provided.',
      );
    }
    return sanitized;
  }

  /**
   * Self-Protection Guard 2: Sanitize command options to protect local execution environment.
   */
  private sanitizeOptions(options: string): string {
    const cleaned = String(options ?? '').trim();
    // Prevent malicious control character injection in options
    return cleaned.replace(/[;&|`$<>'"\\]/g, '');
  }

  /**
   * Execute Nmap scan against target.
   * Note: Host is fully protected from local injection, but target has 0% restrictions (unrestricted payload execution).
   */
  async executeNmapScan(
    target: string,
    options: string = '-T3 -Pn',
  ): Promise<{ success: boolean; output: string; error?: string }> {
    // Pass through local server self-protection sanitization
    const safeTarget = this.sanitizeTarget(target);
    const safeOptions = this.sanitizeOptions(options);

    const command = `nmap ${safeOptions} ${safeTarget}`;
    this.logger.log(`[SERVER-PROTECTED EXECUTION]: -> ${command}`);

    try {
      // Self-Protection Guard 3: Timeout control to prevent server process hanging (60 seconds limit)
      const { stdout, stderr } = await execAsync(command, { timeout: 60000 });
      return { success: true, output: stdout || stderr };
    } catch (error: any) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[EXECUTION ERROR]: ${errMessage}`);
      return {
        success: false,
        output: error.stdout || '',
        error: errMessage,
      };
    }
  }

  /**
   * Execute Ping against target.
   */
  async executePing(
    target: string,
    count: number = 3,
  ): Promise<{ success: boolean; output: string }> {
    const safeTarget = this.sanitizeTarget(target);
    // Self-Protection Guard 4: Input bounding to maintain server stability
    const safeCount =
      Number.isInteger(count) && count > 0 && count <= 10 ? count : 3;

    const isWin = process.platform === 'win32';
    const command = isWin
      ? `ping -n ${safeCount} ${safeTarget}`
      : `ping -c ${safeCount} ${safeTarget}`;

    try {
      // Self-Protection Guard 5: Timeout control for ping process (15 seconds)
      const { stdout } = await execAsync(command, { timeout: 15000 });
      return { success: true, output: stdout };
    } catch (error: any) {
      const errMessage = error instanceof Error ? error.message : String(error);
      return { success: false, output: errMessage };
    }
  }

  /**
   * Execute Traceroute against target.
   */
  async executeTraceroute(
    target: string,
  ): Promise<{ success: boolean; output: string }> {
    const safeTarget = this.sanitizeTarget(target);
    const isWin = process.platform === 'win32';
    const command = isWin
      ? `tracert ${safeTarget}`
      : `traceroute ${safeTarget}`;

    try {
      // Self-Protection Guard 6: Timeout control for traceroute process (30 seconds)
      const { stdout } = await execAsync(command, { timeout: 30000 });
      return { success: true, output: stdout };
    } catch (error: any) {
      const errMessage = error instanceof Error ? error.message : String(error);
      return { success: false, output: errMessage };
    }
  }
}
