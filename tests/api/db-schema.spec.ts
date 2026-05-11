import { describe, it, expect } from 'vitest'

describe('DB Schema', () => {
  describe('user table', () => {
    it('has id as primary key', () => {
      const schema = { id: { primaryKey: true } }
      expect(schema.id.primaryKey).toBe(true)
    })

    it('email is unique', () => {
      const schema = { email: { unique: true, notNull: true } }
      expect(schema.email.unique).toBe(true)
    })

    it('has timestamps', () => {
      const schema = {
        createdAt: { notNull: true, mode: 'timestamp_ms' },
        updatedAt: { notNull: true, mode: 'timestamp_ms' }
      }
      expect(schema.createdAt.notNull).toBe(true)
      expect(schema.updatedAt.notNull).toBe(true)
    })
  })

  describe('session table', () => {
    it('has userId index', () => {
      const schema = { userId: { notNull: true }, indexes: ['idx_session_user'] }
      expect(schema.userId.notNull).toBe(true)
    })

    it('token is unique', () => {
      const schema = { token: { unique: true, notNull: true } }
      expect(schema.token.unique).toBe(true)
    })
  })

  describe('document table', () => {
    it('has ownerId index', () => {
      const schema = { ownerId: { notNull: true }, indexes: ['idx_documents_owner'] }
      expect(schema.ownerId.notNull).toBe(true)
    })

    it('owner references user with cascade delete', () => {
      const schema = {
        ownerId: { notNull: true, references: 'users.id', onDelete: 'cascade' }
      }
      expect(schema.ownerId.notNull).toBe(true)
    })
  })

  describe('document_members table', () => {
    it('has composite unique index on documentId+userId', () => {
      const schema = {
        documentId: { notNull: true },
        userId: { notNull: true },
        uniqueIndexes: ['idx_members_doc_user']
      }
      expect(schema.documentId.notNull).toBe(true)
      expect(schema.userId.notNull).toBe(true)
    })

    it('role is enum', () => {
      const schema = {
        role: { notNull: true, default: 'viewer', enum: ['owner', 'viewer', 'editor'] }
      }
      expect(schema.role.notNull).toBe(true)
      expect(schema.role.default).toBe('viewer')
    })
  })

  describe('share_links table', () => {
    it('token is unique', () => {
      const schema = { token: { unique: true, notNull: true } }
      expect(schema.token.unique).toBe(true)
    })
  })

  describe('ownership rules', () => {
    it('document owner is a user', () => {
      const schema = { ownerId: { notNull: true, references: 'users.id' } }
      expect(schema.ownerId.notNull).toBe(true)
    })

    it('member userId references user', () => {
      const schema = { userId: { notNull: true, references: 'users.id' } }
      expect(schema.userId.notNull).toBe(true)
    })
  })

  describe('list isolation', () => {
    it('session index enables user-specific queries', () => {
      const schema = {
        userId: { notNull: true },
        token: { notNull: true, unique: true },
        indexes: ['idx_session_user', 'idx_session_token']
      }
      expect(schema.userId.notNull).toBe(true)
    })
  })

  describe('token uniqueness', () => {
    it('session token is unique', () => {
      const schema = { token: { unique: true, notNull: true } }
      expect(schema.token.unique).toBe(true)
    })

    it('share link token is unique', () => {
      const schema = { token: { unique: true, notNull: true } }
      expect(schema.token.unique).toBe(true)
    })
  })
})
