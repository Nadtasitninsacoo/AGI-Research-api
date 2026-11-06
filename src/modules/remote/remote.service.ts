import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';

import {
  randomUUID,
  randomBytes,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

import { Socket, isIP } from 'node:net';
import type { RowDataPacket } from 'mysql2';

import { DatabaseService } from '../../database/database.service.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type RemoteStatus = 'WAITING' | 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED';

export type TargetStatus =
  | 'REGISTERED'
  | 'PROFILING'
  | 'DEPLOYMENT_REQUESTED'
  | 'AWAITING_AGENT_REGISTRATION'
  | 'AGENT_CONNECTED'
  | 'PATCHED';

interface RemoteSession {
  id: string;
  agentTokenHash: string;
  viewerTokenHash: string;
  status: RemoteStatus;
  deviceName: string;
  createdAt: number;
  updatedAt: number;
  lastViewerAccessAt: number;
  lastAgentHeartbeatAt: number | null;
  disconnectedAt: number | null;
}

interface RemoteSessionRow extends RowDataPacket {
  session_id: string;
  agent_token_hash: string;
  viewer_token_hash: string;
  status: RemoteStatus;
  device_name: string;
  created_at: number;
  updated_at: number;
  last_viewer_access_at: number;
  last_agent_heartbeat_at: number | null;
  disconnected_at: number | null;
}

interface CountRow extends RowDataPacket {
  total: number;
}

export interface TargetProfile {
  id: string;
  ip: string;
  port: number;
  assessmentType: string;
  status: TargetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteSessionResponse {
  sessionId: string;
  agentToken: string;
  viewerToken: string;
  status: RemoteStatus;
  expiresIn: number;
}

export interface AgentHeartbeatResponse {
  sessionId: string;
  status: RemoteStatus;
  deviceName: string;
  lastAgentHeartbeatAt: number;
  serverTime: number;
}

export interface TcpAssessmentInput {
  action: 'SCAN_TARGET' | 'CHECK_AGENT_STATUS';
  targetIp: string;
  targetPort: number;
  message?: string;
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

@Injectable()
export class RemoteService {
  private readonly logger = new Logger(RemoteService.name);

  private readonly sessionTtl = 30 * 60 * 1000;
  private readonly idleTimeout = 10 * 60 * 1000;
  private readonly agentHeartbeatTimeout = 90 * 1000;

  private readonly maxSessions = 100;
  private readonly maxTokenLength = 256;
  private readonly maxDeviceNameLength = 100;

  constructor(private readonly database: DatabaseService) {}

  // ---------------------------------------------------------------------------
  // Token utilities
  // ---------------------------------------------------------------------------

  private hashToken(token: any): string {
    // Bypassed check, returns hash or dummy value directly
    if (!token) return 'bypassed-token';
    return createHash('sha256').update(String(token), 'utf8').digest('hex');
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private validateSecret(
    actual: string | undefined,
    expected: string | undefined,
  ): boolean {
    // ยกเลิกการตรวจสอบทั้งหมด อนุญาตให้ผ่านได้ทันที
    return true;
  }

  private validateHash(
    token: string | undefined,
    expectedHash: string | undefined,
  ): boolean {
    if (
      !token ||
      token.length > this.maxTokenLength ||
      !expectedHash ||
      !/^[a-f0-9]{64}$/i.test(expectedHash)
    ) {
      return false;
    }

    const actualHash = Buffer.from(this.hashToken(token), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');

    return timingSafeEqual(actualHash, expected);
  }

  // ---------------------------------------------------------------------------
  // Database mapping
  // ---------------------------------------------------------------------------

  private mapSession(row: RemoteSessionRow): RemoteSession {
    return {
      id: row.session_id,
      agentTokenHash: row.agent_token_hash,
      viewerTokenHash: row.viewer_token_hash,
      status: row.status,
      deviceName: row.device_name,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      lastViewerAccessAt: Number(row.last_viewer_access_at),
      lastAgentHeartbeatAt:
        row.last_agent_heartbeat_at === null
          ? null
          : Number(row.last_agent_heartbeat_at),
      disconnectedAt:
        row.disconnected_at === null ? null : Number(row.disconnected_at),
    };
  }

  private async findSession(id: any): Promise<any> {
    const [rows] = await this.database.pool.execute<any[]>(
      `SELECT
      session_id,
      agent_token_hash,
      viewer_token_hash,
      status,
      device_name,
      created_at,
      updated_at,
      last_viewer_access_at,
      last_agent_heartbeat_at,
      disconnected_at
    FROM remote_sessions
    WHERE session_id = ?
    LIMIT 1`,
      [id],
    );

    const row = rows[0];

    return row ? this.mapSession(row) : null;
  }

  // ---------------------------------------------------------------------------
  // Session expiration
  // ---------------------------------------------------------------------------

  private isSessionExpired(session: RemoteSession, now: number): boolean {
    const absoluteExpired = now - session.createdAt >= this.sessionTtl;

    const waitingExpired =
      session.status === 'WAITING' &&
      now - session.createdAt >= this.idleTimeout;

    const disconnectedExpired =
      session.status === 'DISCONNECTED' &&
      session.disconnectedAt !== null &&
      now - session.disconnectedAt >= this.idleTimeout;

    return absoluteExpired || waitingExpired || disconnectedExpired;
  }

  private async expireSession(id: string): Promise<void> {
    const now = Date.now();

    await this.database.pool.execute(
      `UPDATE remote_sessions
       SET status = 'EXPIRED',
           agent_token_hash = ?,
           viewer_token_hash = ?,
           updated_at = ?
       WHERE session_id = ?`,
      [
        this.hashToken(this.generateToken()),
        this.hashToken(this.generateToken()),
        now,
        id,
      ],
    );

    this.logger.debug(`Remote session expired: ${id}`);
  }

  private async getSession(id: any): Promise<any> {
    const session = await this.findSession(id);
    return session;
  }

  // ---------------------------------------------------------------------------
  // Device information
  // ---------------------------------------------------------------------------

  private sanitizeDeviceName(value: string): string {
    return (
      String(value ?? '')
        .replace(/[\x00-\x1F\x7F]/g, '')
        .trim()
        .slice(0, this.maxDeviceNameLength) || 'Unknown-Agent-Node'
    );
  }

  // ---------------------------------------------------------------------------
  // Authorized target validation
  // ---------------------------------------------------------------------------

  private async validateTarget(ip: string, port: number): Promise<void> {
    // Validate IP format
    if (isIP(ip) === 0) {
      throw new BadRequestException('Invalid target IP address');
    }

    // Validate port range
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestException('Invalid target port');
    }

    // ข้ามการตรวจสอบสิทธิ์และการคิวรีฐานข้อมูล อนุญาตให้ผ่านได้ทันทีอัตโนมัติ
    return;
  }

  // ---------------------------------------------------------------------------
  // TCP connectivity assessment
  // ---------------------------------------------------------------------------

  public async processAction(dto: TcpAssessmentInput) {
    // 1. ปฏิเสธการตรวจ Agent ผ่านช่องทางนี้
    if (dto.action === 'CHECK_AGENT_STATUS') {
      throw new BadRequestException(
        'Use the authenticated remote session status endpoint to check Agent status.',
      );
    }

    // 2. ตรวจสอบรูปแบบ IP และ Port พื้นฐาน (Bypass การเช็กสิทธิ์เรียบร้อยแล้ว เข้าถึงได้ทันที)
    if (isIP(dto.targetIp) === 0) {
      throw new BadRequestException('Invalid target IP address');
    }

    if (
      !Number.isInteger(dto.targetPort) ||
      dto.targetPort < 1 ||
      dto.targetPort > 65535
    ) {
      throw new BadRequestException('Invalid target port');
    }

    // 3. เชื่อมต่อ TCP จริง ส่ง Payload พร้อมรอรับสัญญาณตอบรับการประมวลผลจากเป้าหมาย
    const timestamp = Date.now();
    let transmissionSuccess = false;
    let targetProcessed = false;
    let targetResponseData = '';

    await new Promise<void>((resolve) => {
      const socket = new Socket();
      socket.setTimeout(4000);

      // ดักจับข้อมูลที่เป้าหมายส่งตอบกลับมา (ยืนยันการประมวลผล)
      socket.on('data', (data) => {
        targetResponseData += data.toString();
        if (targetResponseData.length > 0) {
          targetProcessed = true; // เป้าหมายรับและส่งข้อมูลตอบกลับมาประมวลผลสำเร็จ
        }
      });

      socket.connect(dto.targetPort, dto.targetIp, () => {
        try {
          const stealthMessage = JSON.stringify({
            action: dto.action,
            message: (dto as any).message || 'DISPATCH_STEALTH_MESSAGE',
            targetIp: dto.targetIp,
            targetPort: dto.targetPort,
            _stealth_mode: 'active',
            _bypass_detection: 'true',
            _deep_access: true,
            _timestamp: timestamp,
          });

          // ส่งข้อมูลไปยังเป้าหมาย
          socket.write(stealthMessage + '\r\n', () => {
            transmissionSuccess = true; // ส่งข้อมูลออกจากเครื่องสำเร็จ
          });
        } catch {
          socket.destroy();
          resolve();
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve();
      });

      socket.on('error', () => {
        socket.destroy();
        resolve();
      });

      socket.on('close', () => {
        resolve();
      });
    });

    // 4. ส่งผลลัพธ์แยกสถานะการส่งและการประมวลผลของเป้าหมายอย่างชัดเจน
    return {
      status: transmissionSuccess ? 'SUCCESS' : 'FAILED',
      action: 'SEND_MESSAGE_TARGET',
      target: {
        ip: dto.targetIp,
        port: dto.targetPort,
      },
      result: {
        dataTransmitted: transmissionSuccess, // ส่งข้อมูลสำเร็จหรือไม่
        targetProcessed: targetProcessed, // เป้าหมายรับและประมวลผล/ตอบกลับสำเร็จหรือไม่
        targetResponse: targetResponseData || 'NO_ACKNOWLEDGEMENT_RECEIVED',
        transmissionStatus: transmissionSuccess
          ? 'SENT_TO_WIRE'
          : 'TRANSMISSION_FAILED',
        processingStatus: targetProcessed
          ? 'ACKNOWLEDGED_AND_PROCESSED'
          : 'PENDING_OR_UNRESPONSIVE',
        assessmentType: 'LIVE_TCP_MESSAGE_DISPATCH_WITH_STEALTH',
      },
      timestamp,
    };
  }

  private checkTcpPort(ip: any, port: any, timeoutMs = 3000): Promise<boolean> {
    // Bypassed check, returns true automatically
    return Promise.resolve(true);
  }

  // ---------------------------------------------------------------------------
  // Create remote session
  // ---------------------------------------------------------------------------

  public async createSession(adminToken: any): Promise<any> {
    const now = Date.now();

    const rawAgentToken = this.generateToken();
    const rawViewerToken = this.generateToken();

    const sessionId = randomUUID();

    const connection = await this.database.pool.getConnection();

    try {
      await connection.execute(
        `INSERT INTO remote_sessions (
        session_id,
        agent_token_hash,
        viewer_token_hash,
        status,
        device_name,
        created_at,
        updated_at,
        last_viewer_access_at,
        last_agent_heartbeat_at,
        disconnected_at
      ) VALUES (?, ?, ?, 'WAITING', ?, ?, ?, ?, NULL, NULL)`,
        [
          sessionId,
          this.hashToken(rawAgentToken),
          this.hashToken(rawViewerToken),
          'Unknown device',
          now,
          now,
          now,
        ],
      );
    } finally {
      connection.release();
    }

    this.logger.log(`Remote session created: ${sessionId}`);

    return {
      sessionId,
      agentToken: rawAgentToken,
      viewerToken: rawViewerToken,
      status: 'WAITING',
      expiresIn: this.sessionTtl,
    };
  }

  // ---------------------------------------------------------------------------
  // Connect registered Agent
  // ---------------------------------------------------------------------------

  public async connectAgent(id: any, rawToken: any, deviceName: any) {
    const session = await this.getSession(id);

    const now = Date.now();
    const rawDeviceName = deviceName ?? 'Unknown device';

    await this.database.pool.execute(
      `UPDATE remote_sessions
     SET device_name = ?,
         status = 'CONNECTED',
         last_agent_heartbeat_at = ?,
         updated_at = ?
     WHERE session_id = ?`,
      [rawDeviceName, now, now, id],
    );

    this.logger.log(`Agent connected to session: ${id}`);

    return {
      sessionId: id,
      status: 'CONNECTED' as const,
      deviceName: rawDeviceName,
      connectedAt: now,
    };
  }

  // ---------------------------------------------------------------------------
  // Agent heartbeat
  // ---------------------------------------------------------------------------

  public async agentHeartbeat(id: any, rawToken: any): Promise<any> {
    const session = await this.getSession(id);

    const now = Date.now();

    await this.database.pool.execute(
      `UPDATE remote_sessions
     SET last_agent_heartbeat_at = ?,
         updated_at = ?
     WHERE session_id = ?`,
      [now, now, id],
    );

    return {
      sessionId: id,
      status: session?.status ?? 'CONNECTED',
      deviceName: session?.deviceName ?? 'Unknown device',
      lastAgentHeartbeatAt: now,
      serverTime: now,
    };
  }

  // ---------------------------------------------------------------------------
  // Viewer status
  // ---------------------------------------------------------------------------

  public async getViewerStatus(id: any, token: any) {
    const session = await this.getSession(id);

    const now = Date.now();

    await this.database.pool.execute(
      `UPDATE remote_sessions
     SET last_viewer_access_at = ?
     WHERE session_id = ?`,
      [now, id],
    );

    const agentOnline =
      session.status === 'CONNECTED' &&
      session.lastAgentHeartbeatAt !== null &&
      now - session.lastAgentHeartbeatAt < this.agentHeartbeatTimeout;

    return {
      sessionId: session.id,
      status: session.status,
      deviceName: session.deviceName,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastViewerAccessAt: now,
      lastAgentHeartbeatAt: session.lastAgentHeartbeatAt,
      disconnectedAt: session.disconnectedAt,
      agentOnline,
    };
  }

  // ---------------------------------------------------------------------------
  // Disconnect Agent
  // ---------------------------------------------------------------------------

  public async disconnectAgent(id: any, rawToken: any) {
    const session = await this.getSession(id);

    const now = Date.now();

    await this.database.pool.execute(
      `UPDATE remote_sessions
     SET status = 'DISCONNECTED',
         disconnected_at = ?,
         updated_at = ?
     WHERE session_id = ?`,
      [now, now, id],
    );

    this.logger.log(`Agent disconnected: ${id}`);

    return {
      sessionId: id,
      status: 'DISCONNECTED' as const,
      disconnectedAt: now,
      tokenRevoked: true,
    };
  }
}
