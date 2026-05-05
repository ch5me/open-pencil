CREATE TABLE accounts_new (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  providerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  providerType TEXT DEFAULT 'credential',
  accessToken TEXT,
  refreshToken TEXT,
  password TEXT,
  expiresAt INTEGER,
  scope TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

INSERT INTO accounts_new (id, userId, providerId, accountId, providerType, accessToken, refreshToken, password, expiresAt, scope, createdAt, updatedAt)
SELECT id, userId, providerId, accountId, COALESCE(providerType, 'credential'), accessToken, refreshToken, password, expiresAt, scope, createdAt, updatedAt
FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(userId);
CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(providerId);
CREATE INDEX IF NOT EXISTS idx_accounts_provider_account ON accounts(providerId, accountId);
