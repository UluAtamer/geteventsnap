CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL,
  banned_until TEXT, last_sign_in_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, full_name TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 100), event_date TEXT NOT NULL,
  event_time TEXT, event_address TEXT, event_type TEXT NOT NULL DEFAULT 'diger',
  slug TEXT NOT NULL UNIQUE, cover_image_url TEXT, welcome_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS event_drive_connections (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_refresh_token TEXT NOT NULL, drive_folder_id TEXT NOT NULL, drive_folder_url TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'connected', connected_at TEXT NOT NULL, last_error_at TEXT
);
CREATE TABLE IF NOT EXISTS uploads_meta (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  drive_file_id TEXT NOT NULL UNIQUE, guest_hash TEXT, file_size BIGINT NOT NULL CHECK(file_size > 0),
  mime_type TEXT NOT NULL, uploaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS csv_locks (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, token TEXT NOT NULL, expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS covers (
  path TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL, content BYTEA NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users(lower(email));
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS events_owner_idx ON events(owner_id);
CREATE INDEX IF NOT EXISTS uploads_event_guest_idx ON uploads_meta(event_id, guest_hash);
REVOKE ALL ON TABLE users, sessions, profiles, events, event_drive_connections, uploads_meta, rate_limits, csv_locks, covers, schema_migrations FROM PUBLIC;
