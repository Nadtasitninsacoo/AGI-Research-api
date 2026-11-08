-- Add password_hash for email+password login (bcrypt). Additive, nullable:
-- existing users keep NULL until a password is set (see scripts/set-password.mjs).
ALTER TABLE users
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER email;
