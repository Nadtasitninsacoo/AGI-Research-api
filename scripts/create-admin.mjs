// Create (or update) a login user with a bcrypt password in ONE step, so a fresh
// machine can log in without a pre-existing users row. Idempotent: re-running with
// the same email just updates the password / display name / role.
//
// Requires the users table and the users.password_hash column to exist
// (run the schema + database/migrations/20261108_add_user_password.sql first).
//
// Usage:
//   node --env-file=.env scripts/create-admin.mjs <email> <password> [displayName] [role]
//   role: admin | researcher | viewer   (default: admin)
import mysql from 'mysql2/promise';
import { hash } from 'bcryptjs';

const [, , email, plainPassword, displayNameArg, roleArg] = process.argv;

if (!email || !plainPassword) {
  console.error(
    'Usage: node --env-file=.env scripts/create-admin.mjs <email> <password> [displayName] [role]',
  );
  process.exit(1);
}
if (plainPassword.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const displayName = displayNameArg || email.split('@')[0] || 'Admin';
const role = ['admin', 'researcher', 'viewer'].includes(roleArg) ? roleArg : 'admin';

const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST || '127.0.0.1',
  port: Number(process.env.DATABASE_PORT ?? 3306),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
});

try {
  const passwordHash = await hash(plainPassword, 12);
  await conn.execute(
    `INSERT INTO users (email, display_name, role, password_hash)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       password_hash = VALUES(password_hash),
       display_name  = VALUES(display_name),
       role          = VALUES(role),
       updated_at    = CURRENT_TIMESTAMP`,
    [email, displayName, role, passwordHash],
  );
  console.log(`OK: user ready -> ${email} (role=${role}). Log in at /login.`);
} catch (e) {
  console.error('FAILED:', e?.code || e?.message || e);
  process.exitCode = 1;
} finally {
  await conn.end();
}
