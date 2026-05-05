ALTER TABLE documents ADD COLUMN description TEXT;
ALTER TABLE documents ADD COLUMN thumbnailUrl TEXT;
ALTER TABLE documents ADD COLUMN latestSnapshotKey TEXT;
ALTER TABLE documents ADD COLUMN isPublic INTEGER DEFAULT 0;
ALTER TABLE documents ADD COLUMN _deleted INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_documents_public ON documents(isPublic);

ALTER TABLE document_members ADD COLUMN id TEXT;
ALTER TABLE document_members ADD COLUMN invitedBy TEXT REFERENCES users(id);
ALTER TABLE document_members ADD COLUMN updatedAt INTEGER;
ALTER TABLE document_members ADD COLUMN _deleted INTEGER DEFAULT 0;

UPDATE document_members
SET id = COALESCE(id, lower(hex(randomblob(16)))),
    updatedAt = COALESCE(updatedAt, createdAt),
    _deleted = COALESCE(_deleted, 0)
WHERE id IS NULL OR updatedAt IS NULL OR _deleted IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_doc_user ON document_members(documentId, userId);
CREATE INDEX IF NOT EXISTS idx_members_document ON document_members(documentId);
CREATE INDEX IF NOT EXISTS idx_members_user ON document_members(userId);

ALTER TABLE document_snapshots ADD COLUMN createdBy TEXT REFERENCES users(id);

ALTER TABLE share_links ADD COLUMN createdBy TEXT REFERENCES users(id);

ALTER TABLE local_doc_imports ADD COLUMN id TEXT;
ALTER TABLE local_doc_imports ADD COLUMN userId TEXT REFERENCES users(id);
ALTER TABLE local_doc_imports ADD COLUMN localDocFingerprint TEXT;

UPDATE local_doc_imports
SET id = COALESCE(id, lower(hex(randomblob(16)))),
    localDocFingerprint = COALESCE(localDocFingerprint, localDocId),
    userId = COALESCE(userId, 'system')
WHERE id IS NULL OR localDocFingerprint IS NULL OR userId IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_imports_user_fingerprint ON local_doc_imports(userId, localDocFingerprint);
