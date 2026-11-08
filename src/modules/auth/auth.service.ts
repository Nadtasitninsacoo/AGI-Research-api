import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import type { RowDataPacket } from 'mysql2';

import { DatabaseService } from '../../database/database.service.js';

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  password_hash: string | null;
  display_name: string | null;
  role: string;
}

export interface AuthenticatedUser {
  id: number;
  email: string;
  role: string;
  displayName: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Verify email + password against the users table (bcrypt). Failures are
   * uniform ("Invalid email or password") so we never reveal whether an email
   * exists or whether it simply has no password set.
   */
  async validateUser(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser> {
    const [rows] = await this.database.pool.execute<UserRow[]>(
      `SELECT id, email, password_hash, display_name, role
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email],
    );

    const user = rows[0];

    if (!user || !user.password_hash) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const ok = await compare(password, user.password_hash);

    if (!ok) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
    };
  }

  /** Validate credentials and issue a signed JWT. */
  async login(email: string, password: string): Promise<{
    access_token: string;
    user: AuthenticatedUser;
  }> {
    const user = await this.validateUser(email, password);

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return { access_token: accessToken, user };
  }
}
