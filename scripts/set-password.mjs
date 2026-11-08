// Set a user's password (bcrypt) so they can log in via POST /api/auth/login.
// Requires the users.password_hash column to exist (run the migration first).
//
// Usage:
//   node --env-file=.env scripts/set-password.mjs <email> <password>
import mysql from 'mysql2/promise';
import { hash } from 'bcryptjs';

const [, , email, plainPassword] = process.argv;

if (!email || !plainPassword) {
  console.error(
    'Usage: node --env-file=.env scripts/set-password.mjs <email> <password>',
  );
  process.exit(1);
}

if (plainPassword.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST || '127.0.0.1',
  port: Number(process.env.DATABASE_PORT ?? 3306),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
});

try {
  const passwordHash = await hash(plainPassword, 12);
  const [result] = await conn.execute(
    `UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?`,
    [passwordHash, email],
  );
  if (result.affectedRows > 0) {
    console.log(`OK: password set for ${email}`);
  } else {
    console.log(`No user found with email: ${email}`);
  }
} catch (e) {
  console.error('FAILED:', e?.code || e?.message || e);
  process.exitCode = 1;
} finally {
  await conn.end();
}
