CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  image TEXT,
  emailVerified INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  providerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  expiresAt INTEGER,
  scope TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expiresAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(userId);
CREATE INDEX IF NOT EXISTS idx_session_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_session_expires ON sessions(expiresAt);

CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  description TEXT,
  thumbnailUrl TEXT,
  latestSnapshotKey TEXT,
  isPublic INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  _deleted INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(ownerId);
CREATE INDEX IF NOT EXISTS idx_documents_public ON documents(isPublic);

CREATE TABLE IF NOT EXISTS document_members (
  id TEXT PRIMARY KEY,
  documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  invitedBy TEXT REFERENCES users(id),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  _deleted INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_doc_user ON document_members(documentId, userId);
CREATE INDEX IF NOT EXISTS idx_members_document ON document_members(documentId);
CREATE INDEX IF NOT EXISTS idx_members_user ON document_members(userId);

CREATE TABLE IF NOT EXISTS document_snapshots (
  id TEXT PRIMARY KEY,
  documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  snapshotKey TEXT NOT NULL,
  size INTEGER NOT NULL,
  createdBy TEXT REFERENCES users(id),
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_document ON document_snapshots(documentId);

CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'viewer',
  expiresAt INTEGER,
  createdBy TEXT REFERENCES users(id),
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_token ON share_links(token);
CREATE INDEX IF NOT EXISTS idx_links_document ON share_links(documentId);

CREATE TABLE IF NOT EXISTS local_doc_imports (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  localDocFingerprint TEXT NOT NULL,
  hostedDocId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  importedAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_imports_user_fingerprint ON local_doc_imports(userId, localDocFingerprint);