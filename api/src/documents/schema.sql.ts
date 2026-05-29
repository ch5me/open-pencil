export const HOSTED_DOCUMENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS hosted_documents (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_format TEXT NOT NULL CHECK (source_format IN ('fig', 'pen')),
  current_snapshot_id TEXT NOT NULL,
  current_snapshot_storage_key TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hosted_snapshots (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES hosted_documents(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  parent_snapshot_id TEXT REFERENCES hosted_snapshots(id),
  storage_key TEXT NOT NULL UNIQUE,
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  content_hash TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('initial-import', 'manual-save', 'autosave', 'duplicate')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hosted_assets (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES hosted_documents(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES hosted_snapshots(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'font', 'binary')),
  storage_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  media_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hosted_document_migrations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES hosted_documents(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('create-empty', 'import-local', 'promote-local', 'duplicate-hosted')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('untitled-memory', 'browser-file-handle', 'tauri-file-path', 'browser-download', 'io-registry', 'hosted-document')),
  source_format TEXT NOT NULL CHECK (source_format IN ('fig', 'pen')),
  source_name TEXT,
  source_fingerprint TEXT,
  initial_snapshot_id TEXT NOT NULL REFERENCES hosted_snapshots(id),
  state TEXT NOT NULL CHECK (state IN ('pending', 'complete', 'failed')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_hosted_documents_owner_updated ON hosted_documents(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hosted_snapshots_document_created ON hosted_snapshots(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hosted_assets_document ON hosted_assets(document_id);
CREATE INDEX IF NOT EXISTS idx_hosted_migrations_document ON hosted_document_migrations(document_id, created_at DESC);
`
