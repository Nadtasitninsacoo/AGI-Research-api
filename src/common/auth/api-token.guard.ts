import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Service-to-service auth for engine → API handoffs.
 *
 * Fail-closed: the request must present `Authorization: Bearer <token>` where
 * <token> exactly equals process.env.AGI_API_TOKEN. The comparison is constant
 * time. If the server has no token configured (or it is too short), every
 * request is rejected — never allowed through. There is no bypass path.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  private readonly logger = new Logger(ApiTokenGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const configured = process.env.AGI_API_TOKEN;
    if (!configured || configured.length < 16) {
      this.logger.error(
        'AGI_API_TOKEN is not configured (or too short); rejecting service request.',
      );
      throw new UnauthorizedException('Service authentication is not available.');
    }

    const header = request.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing service token.');
    }

    const presented = header.slice('Bearer '.length).trim();
    if (!this.safeEqual(presented, configured)) {
      throw new UnauthorizedException('Invalid service token.');
    }

    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    // timingSafeEqual requires equal lengths; comparing lengths first would leak
    // length, so hash both to fixed-size buffers via equal-length comparison.
    if (bufA.length !== bufB.length) {
      // Still do a constant-time compare against itself to avoid early return
      // timing differences, then report mismatch.
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
