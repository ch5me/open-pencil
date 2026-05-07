import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Better Auth tables (singular per plan spec)
export const user = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  image: text('image'),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).default(false),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
})

export const account = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  providerId: text('providerId').notNull(),
  accountId: text('accountId').notNull(),
  providerType: text('providerType').default('credential'),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  password: text('password'),
  expiresAt: integer('expiresAt'),
  scope: text('scope'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
})

export const session = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  index('idx_session_user').on(t.userId),
  index('idx_session_token').on(t.token),
  index('idx_session_expires').on(t.expiresAt),
])

export const verification = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
})

// OpenPencil domain tables
export const document = sqliteTable('documents', {
  id: text('id').primaryKey(),
  ownerId: text('ownerId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('Untitled'),
  description: text('description'),
  thumbnailUrl: text('thumbnailUrl'),
  latestSnapshotKey: text('latestSnapshotKey'),
  isPublic: integer('isPublic', { mode: 'boolean' }).default(false),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  _deleted: integer('_deleted', { mode: 'boolean' }).default(false),
}, (t) => [
  index('idx_documents_owner').on(t.ownerId),
  index('idx_documents_public').on(t.isPublic),
])

export const documentMember = sqliteTable('document_members', {
  id: text('id').primaryKey(),
  documentId: text('documentId').notNull().references(() => document.id, { onDelete: 'cascade' }),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'viewer', 'editor'] }).notNull().default('viewer'),
  invitedBy: text('invitedBy').references(() => user.id),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  _deleted: integer('_deleted', { mode: 'boolean' }).default(false),
}, (t) => [
  uniqueIndex('idx_members_doc_user').on(t.documentId, t.userId),
  index('idx_members_document').on(t.documentId),
  index('idx_members_user').on(t.userId),
])

export const documentSnapshot = sqliteTable('document_snapshots', {
  id: text('id').primaryKey(),
  documentId: text('documentId').notNull().references(() => document.id, { onDelete: 'cascade' }),
  snapshotKey: text('snapshotKey').notNull(),
  size: integer('size').notNull(),
  createdBy: text('createdBy').references(() => user.id),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  index('idx_snapshots_document').on(t.documentId),
])

export const shareLink = sqliteTable('share_links', {
  id: text('id').primaryKey(),
  documentId: text('documentId').notNull().references(() => document.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  role: text('role', { enum: ['viewer', 'editor'] }).notNull().default('viewer'),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }),
  createdBy: text('createdBy').references(() => user.id),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  index('idx_links_token').on(t.token),
  index('idx_links_document').on(t.documentId),
])

export const localDocImport = sqliteTable('local_doc_imports', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  localDocFingerprint: text('localDocFingerprint').notNull(),
  hostedDocId: text('hostedDocId').notNull().references(() => document.id, { onDelete: 'cascade' }),
  importedAt: integer('importedAt', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  uniqueIndex('idx_imports_user_fingerprint').on(t.userId, t.localDocFingerprint),
])

export const userProviderKey = sqliteTable('user_provider_keys', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  providerId: text('providerId', { enum: ['openrouter', 'scenario'] }).notNull(),
  encryptedKey: text('encryptedKey').notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  uniqueIndex('idx_user_provider_keys_user_provider').on(t.userId, t.providerId),
  index('idx_user_provider_keys_user').on(t.userId),
])
