CREATE TABLE IF NOT EXISTS user_provider_keys (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  providerId TEXT NOT NULL,
  encryptedKey TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_provider_keys_user_provider
  ON user_provider_keys(userId, providerId);

CREATE INDEX IF NOT EXISTS idx_user_provider_keys_user
  ON user_provider_keys(userId);
