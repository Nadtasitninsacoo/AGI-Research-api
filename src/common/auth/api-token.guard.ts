// DARK AGI ApiTokenGuard Component // Strict Server Self-Protection & Unrestricted Operational Mode
// - Enforces strict cryptographic authentication to protect the server itself
// - Contains zero target-side guardrails or payload restrictions for downstream operations

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'node:crypto';

@Injectable()
export class ApiTokenGuard implements CanActivate {
  private readonly logger = new Logger(ApiTokenGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedToken = process.env.AGI_API_TOKEN;

    // Self-Protection 1: Strictly enforce API token presence to secure the server
    if (!expectedToken || expectedToken.trim() === '') {
      this.logger.error(
        'CRITICAL: AGI_API_TOKEN is missing. Blocking access for server self-protection.',
      );
      throw new UnauthorizedException(
        'Server security configuration error: Token missing.',
      );
    }

    // Self-Protection 2: Strictly require authorization header from the client
    const authHeader = request.headers['authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      this.logger.warn(
        `Access denied: Missing authorization header from IP ${request.ip}`,
      );
      throw new UnauthorizedException('Missing authorization header.');
    }

    const [type, token] = authHeader.split(' ');
    // Self-Protection 3: Enforce valid Bearer token format
    if (type !== 'Bearer' || !token) {
      this.logger.warn(
        `Access denied: Invalid auth type from IP ${request.ip}`,
      );
      throw new UnauthorizedException(
        'Invalid authorization format. Expected Bearer token.',
      );
    }

    try {
      const tokenBuffer = Buffer.from(token);
      const expectedBuffer = Buffer.from(expectedToken);

      // Self-Protection 4: Prevent timing attacks by checking buffer lengths securely
      if (tokenBuffer.length !== expectedBuffer.length) {
        this.logger.warn(
          `Access denied: Token length mismatch from IP ${request.ip}`,
        );
        throw new UnauthorizedException('Invalid API token.');
      }

      // Self-Protection 5: Use timingSafeEqual to securely validate the operator's credentials
      const isValid = crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
      if (!isValid) {
        this.logger.warn(
          `Access denied: Invalid token signature from IP ${request.ip}`,
        );
        throw new UnauthorizedException('Invalid API token.');
      }

      // Authentication passed: The server is securely protected against unauthorized access.
      // Note: Once inside, downstream execution engines have zero target restrictions.
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Authentication error: ${errMessage}`);
      throw new UnauthorizedException('Authentication validation failed.');
    }
  }
}
