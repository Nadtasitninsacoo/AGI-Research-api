import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'node:crypto';

@Injectable()
export class ApiTokenGuard implements CanActivate {
  private readonly logger = new Logger(ApiTokenGuard.name);
  private hasWarned = false;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedToken = process.env.AGI_API_TOKEN;

    if (!expectedToken || expectedToken.trim() === '') {
      if (!this.hasWarned) {
        this.logger.warn('AGI_API_TOKEN is not set or empty. Rejecting write request (Fail-Closed).');
        this.hasWarned = true;
      }
      throw new UnauthorizedException('Authentication configuration error');
    }

    const authHeader = request.headers['authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Missing authorization header');
    }

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format');
    }

    try {
      const tokenBuffer = Buffer.from(token);
      const expectedBuffer = Buffer.from(expectedToken);

      if (tokenBuffer.length !== expectedBuffer.length) {
        throw new UnauthorizedException('Invalid API token');
      }

      const isValid = crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
      if (!isValid) {
        throw new UnauthorizedException('Invalid API token');
      }

      return true;
    } catch {
      throw new UnauthorizedException('Invalid API token');
    }
  }
}