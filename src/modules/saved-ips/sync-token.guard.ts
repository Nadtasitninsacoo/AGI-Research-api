import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Guards the DARK AGI sync endpoint. The shared token lives ONLY in the
 * backend env var DARK_AGI_SYNC_TOKEN — never hardcoded, never shipped to the
 * frontend. Fails closed: if the env var is missing/weak the endpoint is
 * unreachable (401) rather than open. Comparison is constant-time.
 */
@Injectable()
export class SyncTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = (process.env.DARK_AGI_SYNC_TOKEN ?? '').trim();
    if (expected.length < 16) {
      // Fail closed — a missing/short token means the feed stays shut.
      throw new UnauthorizedException('Sync endpoint is not configured.');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['authorization'];
    if (!header || typeof header !== 'string') {
      throw new UnauthorizedException('Missing authorization header.');
    }

    const [type, token] = header.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Expected a Bearer token.');
    }

    if (!this.safeEqual(token, expected)) {
      throw new UnauthorizedException('Invalid sync token.');
    }
    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
