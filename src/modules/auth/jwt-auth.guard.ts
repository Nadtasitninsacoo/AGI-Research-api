import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface JwtPayload {
  sub: number;
  email: string;
  role: string;
}

/**
 * Requires a valid, non-expired JWT (issued by /api/auth/login) in the
 * Authorization: Bearer header. Attaches the decoded user to request.user.
 * Rejects with 401 when the token is missing, malformed, invalid, or expired.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const authHeader = request.headers['authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Login required: missing authorization header.');
    }

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Login required: expected a Bearer token.');
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      (request as Request & { user?: JwtPayload }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Session invalid or expired. Please log in again.');
    }
  }
}
