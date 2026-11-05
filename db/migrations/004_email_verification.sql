ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TEXT;
-- Administrators were provisioned by the operator, rather than public registration.
UPDATE users SET email_verified_at = created_at WHERE is_admin = TRUE AND email_verified_at IS NULL;
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email_verified_at IS NULL);
CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_verifications_user_idx ON email_verifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS email_verifications_expiry_idx ON email_verifications(expires_at);
REVOKE ALL ON TABLE email_verifications FROM PUBLIC;
