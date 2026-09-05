PRAGMA foreign_keys = ON;

CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  invite_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  UNIQUE(space_id, normalized_name)
);
CREATE INDEX profiles_by_space ON profiles(space_id, updated_at DESC);

CREATE TABLE projects (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_version INTEGER NOT NULL,
  quest_id INTEGER NOT NULL CHECK (quest_id BETWEEN 1 AND 12),
  kind TEXT NOT NULL CHECK (kind IN ('current', 'legacy')),
  project_json TEXT NOT NULL CHECK (json_valid(project_json)),
  PRIMARY KEY(profile_id, course_version, quest_id, kind)
);

CREATE TABLE profile_mutations (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, mutation_id)
);

-- Raising an error (rather than an UPDATE affecting zero rows) rolls the entire
-- D1 batch back, including all project and progress writes.
CREATE TRIGGER profile_mutation_revision_guard
BEFORE INSERT ON profile_mutations
WHEN NOT EXISTS (
  SELECT 1 FROM profiles
  WHERE id = NEW.profile_id AND space_id = NEW.space_id AND revision = NEW.expected_revision
)
BEGIN
  SELECT RAISE(ABORT, 'revision_conflict');
END;

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
