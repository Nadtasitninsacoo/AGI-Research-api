// Create a login in ONE step on a fresh machine: it creates the database and the
// users table if they don't exist yet, then creates (or updates) the user with a
// bcrypt password. No separate schema import or migration needed just to log in.
// Idempotent — safe to re-run; re-running updates the password / name / role.
//
// Prerequisite: a running MySQL the .env DATABASE_* values point to.
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

const dbName = process.env.DATABASE_NAME || 'agi_research';
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error(`Invalid DATABASE_NAME: ${dbName}`);
  process.exit(1);
}

// Connect WITHOUT a database first, so we can create it if the machine is fresh.
const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST || '127.0.0.1',
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
});

try {
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4`);
  await conn.query(`USE \`${dbName}\``);

  // Minimal users table (matches db/schema.sql + the password_hash migration), so
  // login works even before the full schema is imported.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email         VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NULL,
      display_name  VARCHAR(120) NOT NULL,
      role          ENUM('admin','researcher','viewer') NOT NULL DEFAULT 'researcher',
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

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
  console.log(`OK: user ready -> ${email} (role=${role}) in DB "${dbName}". Log in at /login.`);
} catch (e) {
  console.error('FAILED:', e?.code || e?.message || e);
  if (e?.code === 'ECONNREFUSED') {
    console.error('-> MySQL is not running / not reachable. Start it (e.g. Laragon "Start All") and check DATABASE_HOST/PORT in .env.');
  }
  process.exitCode = 1;
} finally {
  await conn.end();
}
