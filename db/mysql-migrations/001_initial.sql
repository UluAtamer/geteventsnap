-- MySQL/MariaDB schema. Equivalent to db/migrations/001–005 (PostgreSQL, kept unchanged for history).
-- Keys are case-sensitive (utf8mb4_bin); email uniqueness is case-insensitive.
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  email VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  banned_until VARCHAR(40) NULL,
  last_sign_in_at VARCHAR(40) NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at VARCHAR(40) NULL,
  UNIQUE KEY users_email_idx (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash VARCHAR(128) NOT NULL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  KEY sessions_expiry_idx (expires_at),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS profiles (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  full_name TEXT NULL,
  created_at VARCHAR(40) NOT NULL,
  CONSTRAINT profiles_user_fk FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_id VARCHAR(64) NOT NULL,
  title VARCHAR(100) NOT NULL,
  event_date VARCHAR(20) NOT NULL,
  event_time VARCHAR(20) NULL,
  event_address TEXT NULL,
  event_type VARCHAR(40) NOT NULL DEFAULT 'diger',
  slug VARCHAR(191) NOT NULL,
  cover_image_url TEXT NULL,
  welcome_message VARCHAR(2000) NOT NULL DEFAULT '',
  created_at VARCHAR(40) NOT NULL,
  dating_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE KEY events_slug_idx (slug),
  KEY events_owner_idx (owner_id),
  CONSTRAINT events_title_len CHECK (CHAR_LENGTH(title) BETWEEN 2 AND 100),
  CONSTRAINT events_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS event_drive_connections (
  event_id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_id VARCHAR(64) NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  drive_folder_id VARCHAR(255) NOT NULL,
  drive_folder_url TEXT NOT NULL,
  connection_status VARCHAR(40) NOT NULL DEFAULT 'connected',
  connected_at VARCHAR(40) NOT NULL,
  last_error_at VARCHAR(40) NULL,
  CONSTRAINT drive_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT drive_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS uploads_meta (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL,
  drive_file_id VARCHAR(255) NOT NULL,
  guest_hash VARCHAR(128) NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(255) NOT NULL,
  uploaded_at VARCHAR(40) NOT NULL,
  UNIQUE KEY uploads_drive_file_idx (drive_file_id),
  KEY uploads_event_guest_idx (event_id, guest_hash),
  CONSTRAINT uploads_size_positive CHECK (file_size > 0),
  CONSTRAINT uploads_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket VARCHAR(255) NOT NULL PRIMARY KEY,
  window_start INT NOT NULL,
  count INT NOT NULL,
  KEY rate_limits_window_idx (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS csv_locks (
  event_id VARCHAR(64) NOT NULL PRIMARY KEY,
  token VARCHAR(255) NOT NULL,
  expires BIGINT NOT NULL,
  CONSTRAINT csv_locks_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS covers (
  path VARCHAR(512) NOT NULL PRIMARY KEY,
  owner_id VARCHAR(64) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  content LONGBLOB NOT NULL,
  KEY covers_owner_idx (owner_id),
  CONSTRAINT covers_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash VARCHAR(128) NOT NULL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  KEY email_verifications_user_idx (user_id, created_at),
  KEY email_verifications_expiry_idx (expires_at),
  CONSTRAINT email_verifications_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS guest_profiles (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL,
  guest_token_hash VARCHAR(128) NOT NULL,
  first_name VARCHAR(40) NOT NULL,
  age INT NOT NULL,
  bio VARCHAR(240) NOT NULL DEFAULT '',
  contact_type VARCHAR(20) NULL,
  contact_value VARCHAR(80) NULL,
  photo_type VARCHAR(20) NOT NULL,
  photo_content MEDIUMBLOB NOT NULL,
  consented_at VARCHAR(40) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  UNIQUE KEY guest_profiles_token_idx (event_id, guest_token_hash),
  UNIQUE KEY guest_profiles_event_id_idx (event_id, id),
  CONSTRAINT guest_first_name_len CHECK (CHAR_LENGTH(first_name) BETWEEN 1 AND 40),
  CONSTRAINT guest_age_range CHECK (age BETWEEN 18 AND 120),
  CONSTRAINT guest_contact_type CHECK (contact_type IN ('instagram','phone')),
  CONSTRAINT guest_contact_pair CHECK ((contact_type IS NULL) = (contact_value IS NULL)),
  CONSTRAINT guest_photo_type CHECK (photo_type IN ('image/jpeg','image/png','image/webp')),
  CONSTRAINT guest_photo_size CHECK (OCTET_LENGTH(photo_content) BETWEEN 1 AND 5242880),
  CONSTRAINT guest_profiles_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- MySQL forbids CHECK constraints on columns used by cascading foreign keys,
-- so "not self" and "profile_a < profile_b" are enforced in src/lib/dating-server.ts.
CREATE TABLE IF NOT EXISTS dating_likes (
  event_id VARCHAR(64) NOT NULL,
  liker_profile_id VARCHAR(64) NOT NULL,
  liked_profile_id VARCHAR(64) NOT NULL,
  liked BOOLEAN NOT NULL,
  PRIMARY KEY (event_id, liker_profile_id, liked_profile_id),
  CONSTRAINT likes_liker_fk FOREIGN KEY (event_id, liker_profile_id) REFERENCES guest_profiles(event_id, id) ON DELETE CASCADE,
  CONSTRAINT likes_liked_fk FOREIGN KEY (event_id, liked_profile_id) REFERENCES guest_profiles(event_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS dating_matches (
  event_id VARCHAR(64) NOT NULL,
  profile_a VARCHAR(64) NOT NULL,
  profile_b VARCHAR(64) NOT NULL,
  PRIMARY KEY (event_id, profile_a, profile_b),
  CONSTRAINT matches_a_fk FOREIGN KEY (event_id, profile_a) REFERENCES guest_profiles(event_id, id) ON DELETE CASCADE,
  CONSTRAINT matches_b_fk FOREIGN KEY (event_id, profile_b) REFERENCES guest_profiles(event_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS dating_blocks (
  event_id VARCHAR(64) NOT NULL,
  blocker_profile_id VARCHAR(64) NOT NULL,
  blocked_profile_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (event_id, blocker_profile_id, blocked_profile_id),
  CONSTRAINT blocks_blocker_fk FOREIGN KEY (event_id, blocker_profile_id) REFERENCES guest_profiles(event_id, id) ON DELETE CASCADE,
  CONSTRAINT blocks_blocked_fk FOREIGN KEY (event_id, blocked_profile_id) REFERENCES guest_profiles(event_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS dating_reports (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL,
  reporter_profile_id VARCHAR(64) NULL,
  reported_profile_id VARCHAR(64) NULL,
  reason VARCHAR(300) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at VARCHAR(40) NOT NULL,
  KEY dating_reports_owner_idx (event_id, status),
  CONSTRAINT reports_reason_len CHECK (CHAR_LENGTH(reason) BETWEEN 3 AND 300),
  CONSTRAINT reports_status CHECK (status IN ('pending','reviewed','removed')),
  CONSTRAINT reports_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT reports_reporter_fk FOREIGN KEY (reporter_profile_id) REFERENCES guest_profiles(id) ON DELETE SET NULL,
  CONSTRAINT reports_reported_fk FOREIGN KEY (reported_profile_id) REFERENCES guest_profiles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
