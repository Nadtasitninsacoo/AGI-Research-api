import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

@Injectable()
export class NetworkToolsService {
  private readonly logger = new Logger(NetworkToolsService.name);

  /**
   * รันคำสั่ง Nmap สำหรับสแกนพอร์ตและประเมินเป้าหมาย
   * พร้อมระบบพรางตัวและจัดการข้อผิดพลาดอัตโนมัติ
   */
  async executeNmapScan(
    target: string,
    options: string = '-T3 -Pn',
  ): Promise<{ success: boolean; output: string; error?: string }> {
    // ป้องกันการฉีดคำสั่งที่ไม่ปลอดภัย (Command Injection Basic Sanitization)
    const sanitizedTarget = String(target ?? '')
      .trim()
      .replace(/[;&|`$]/g, '');
    const sanitizedOptions = String(options ?? '')
      .trim()
      .replace(/[;&|`$]/g, '');

    const command = `nmap ${sanitizedOptions} ${sanitizedTarget}`;
    this.logger.log(`[NETWORK-TOOL]: Executing -> ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 60000 });
      return {
        success: true,
        output: stdout || stderr,
      };
    } catch (error: any) {
      this.logger.error(`[NETWORK-TOOL ERROR]: ${error.message}`);
      return {
        success: false,
        output: error.stdout || '',
        error: error.message,
      };
    }
  }

  /**
   * ตรวจสอบสถานะการเชื่อมต่อโฮสต์ด้วยคำสั่ง Ping
   */
  async executePing(
    target: string,
    count: number = 3,
  ): Promise<{ success: boolean; output: string }> {
    const sanitizedTarget = String(target ?? '')
      .trim()
      .replace(/[;&|`$]/g, '');
    const safeCount = Number.isInteger(count) && count > 0 ? count : 3;

    // กำหนดรูปแบบตามระบบปฏิบัติการ (Windows / Linux)
    const isWin = process.platform === 'win32';
    const command = isWin
      ? `ping -n ${safeCount} ${sanitizedTarget}`
      : `ping -c ${safeCount} ${sanitizedTarget}`;

    try {
      const { stdout } = await execAsync(command, { timeout: 15000 });
      return { success: true, output: stdout };
    } catch (error: any) {
      return { success: false, output: error.message };
    }
  }

  /**
   * ดึงข้อมูลเส้นทางเครือข่าย (Traceroute / Tracert)
   */
  async executeTraceroute(
    target: string,
  ): Promise<{ success: boolean; output: string }> {
    const sanitizedTarget = String(target ?? '')
      .trim()
      .replace(/[;&|`$]/g, '');
    const isWin = process.platform === 'win32';
    const command = isWin
      ? `tracert ${sanitizedTarget}`
      : `traceroute ${sanitizedTarget}`;

    try {
      const { stdout } = await execAsync(command, { timeout: 30000 });
      return { success: true, output: stdout };
    } catch (error: any) {
      return { success: false, output: error.message };
    }
  }
}
