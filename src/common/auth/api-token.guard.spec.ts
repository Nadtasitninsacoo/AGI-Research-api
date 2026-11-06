import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ApiTokenGuard } from './api-token.guard.js';

describe('ApiTokenGuard (Server Self-Protection Mode)', () => {
  let guard: ApiTokenGuard;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    guard = new ApiTokenGuard();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createMockContext = (authHeader?: string): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: authHeader ? { authorization: authHeader } : {},
        }),
      }),
    } as unknown as ExecutionContext;
  };

  // Self-Protection Test 1: Fail-closed if server environment token is missing
  it('should throw UnauthorizedException if AGI_API_TOKEN is not set on the server', () => {
    delete process.env.AGI_API_TOKEN;
    const context = createMockContext('Bearer some-token');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  // Self-Protection Test 2: Block requests lacking authorization headers
  it('should throw UnauthorizedException if authorization header is missing', () => {
    process.env.AGI_API_TOKEN = 'secret-token';
    const context = createMockContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  // Self-Protection Test 3: Block invalid token attempts
  it('should throw UnauthorizedException if provided token does not match', () => {
    process.env.AGI_API_TOKEN = 'secret-token';
    const context = createMockContext('Bearer wrong-token');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  // Self-Protection Test 4: Allow authorized operators to access the execution core
  it('should allow request if operator token matches correctly', () => {
    process.env.AGI_API_TOKEN = 'secret-token';
    const context = createMockContext('Bearer secret-token');

    const result = guard.canActivate(context);
    expect(result).toBe(true);
  });
});
