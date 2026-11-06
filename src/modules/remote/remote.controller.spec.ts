import { ValidationPipe } from '@nestjs/common';

import { ExploitRequestDto } from './dto/exploit.dto.js';
import { ConnectAgentDto } from './remote.controller.js';

describe('Remote request validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('accepts the remote session flags sent by the client UI', async () => {
    const payload = {
      deviceName: 'Test-Agent',
      unrestrictedMode: true,
      executePayload: false,
    };

    await expect(
      pipe.transform(payload, {
        type: 'body',
        metatype: ConnectAgentDto,
      }),
    ).resolves.toMatchObject({
      deviceName: 'Test-Agent',
      unrestrictedMode: true,
      executePayload: false,
    });
  });

  it('converts string booleans from the front-end into real booleans', async () => {
    const payload = {
      deviceName: 'Test-Agent',
      unrestrictedMode: 'true',
      executePayload: 'false',
    };

    await expect(
      pipe.transform(payload, {
        type: 'body',
        metatype: ConnectAgentDto,
      }),
    ).resolves.toMatchObject({
      deviceName: 'Test-Agent',
      unrestrictedMode: true,
      executePayload: false,
    });
  });

  it('accepts exploit flags used by the remote API payload contract', async () => {
    const payload = {
      action: 'SCAN_TARGET',
      targetIp: '127.0.0.1',
      targetPort: 8080,
      exploitVector: 'tcp',
      unrestrictedMode: 'true',
      executePayload: 'false',
    };

    await expect(
      pipe.transform(payload, {
        type: 'body',
        metatype: ExploitRequestDto,
      }),
    ).resolves.toMatchObject({
      action: 'SCAN_TARGET',
      targetIp: '127.0.0.1',
      targetPort: 8080,
      exploitVector: 'tcp',
      unrestrictedMode: true,
      executePayload: false,
    });
  });

  it('retains the real boolean flags on the active remote session', () => {
    const service = {
      sessions: new Map(),
    } as any;

    const session = {
      id: 's-1',
      agentTokenHash: '64f0f0e2f0a1a46ad017d7399e89d2c0d63d0b5d6f3bc20c01d3f9f8d2a91fdb',
      viewerTokenHash: '64f0f0e2f0a1a46ad017d7399e89d2c0d63d0b5d6f3bc20c01d3f9f8d2a91fdb',
      status: 'WAITING',
      deviceName: 'Test-Agent',
      unrestrictedMode: false,
      executePayload: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastAccessedAt: Date.now(),
      lastAgentHeartbeatAt: null,
      disconnectedAt: null,
    };

    service.sessions.set(session.id, session);

    expect(session.unrestrictedMode).toBe(false);
    expect(session.executePayload).toBe(false);
  });
});
