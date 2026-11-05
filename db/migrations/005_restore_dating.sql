ALTER TABLE events ADD COLUMN IF NOT EXISTS dating_enabled BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS guest_profiles (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_token_hash TEXT NOT NULL,
  first_name TEXT NOT NULL CHECK(length(first_name) BETWEEN 1 AND 40),
  age INTEGER NOT NULL CHECK(age BETWEEN 18 AND 120),
  bio TEXT NOT NULL DEFAULT '' CHECK(length(bio) <= 240),
  contact_type TEXT CHECK(contact_type IN ('instagram','phone')),
  contact_value TEXT CHECK(contact_value IS NULL OR length(contact_value) <= 80),
  photo_type TEXT NOT NULL CHECK(photo_type IN ('image/jpeg','image/png','image/webp')),
  photo_content BYTEA NOT NULL CHECK(octet_length(photo_content) BETWEEN 1 AND 5242880),
  consented_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, guest_token_hash),
  UNIQUE(event_id, id),
  CHECK((contact_type IS NULL) = (contact_value IS NULL))
);
CREATE TABLE IF NOT EXISTS dating_likes (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  liker_profile_id TEXT NOT NULL,
  liked_profile_id TEXT NOT NULL,
  liked BOOLEAN NOT NULL,
  PRIMARY KEY(event_id, liker_profile_id, liked_profile_id),
  FOREIGN KEY(event_id, liker_profile_id) REFERENCES guest_profiles(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id, liked_profile_id) REFERENCES guest_profiles(event_id,id) ON DELETE CASCADE,
  CHECK(liker_profile_id <> liked_profile_id)
);
CREATE TABLE IF NOT EXISTS dating_matches (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  profile_a TEXT NOT NULL,
  profile_b TEXT NOT NULL,
  PRIMARY KEY(event_id, profile_a, profile_b),
  FOREIGN KEY(event_id, profile_a) REFERENCES guest_profiles(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id, profile_b) REFERENCES guest_profiles(event_id,id) ON DELETE CASCADE,
  CHECK(profile_a < profile_b)
);
CREATE TABLE IF NOT EXISTS dating_blocks (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  blocker_profile_id TEXT NOT NULL,
  blocked_profile_id TEXT NOT NULL,
  PRIMARY KEY(event_id, blocker_profile_id, blocked_profile_id),
  FOREIGN KEY(event_id, blocker_profile_id) REFERENCES guest_profiles(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id, blocked_profile_id) REFERENCES guest_profiles(event_id,id) ON DELETE CASCADE,
  CHECK(blocker_profile_id <> blocked_profile_id)
);
CREATE TABLE IF NOT EXISTS dating_reports (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reporter_profile_id TEXT REFERENCES guest_profiles(id) ON DELETE SET NULL,
  reported_profile_id TEXT REFERENCES guest_profiles(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','removed')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_profiles_event_idx ON guest_profiles(event_id);
CREATE INDEX IF NOT EXISTS dating_reports_owner_idx ON dating_reports(event_id,status);
REVOKE ALL ON guest_profiles, dating_likes, dating_matches, dating_blocks, dating_reports FROM PUBLIC;
