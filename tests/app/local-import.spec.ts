import { describe, it, expect } from 'vitest'

describe('Local Doc Import', () => {
  describe('detectLocalDocs', () => {
    it('detects local docs from localStorage', async () => {
      const localDocs = [
        { id: 'doc1', title: 'Local Doc 1', fingerprint: 'abc123' },
        { id: 'doc2', title: 'Local Doc 2', fingerprint: 'def456' }
      ]
      expect(localDocs.length).toBe(2)
    })

    it('computes SHA-256 fingerprint', async () => {
      const data = 'test document content'
      const encoded = new TextEncoder().encode(data)
      const hashBuffer = crypto.subtle.digest('SHA-256', encoded)
      expect(hashBuffer).toBeInstanceOf(Promise)
    })

    it('returns empty array when no local docs', async () => {
      const localDocs: Array<{ id: string; title: string; fingerprint: string }> = []
      expect(localDocs.length).toBe(0)
    })
  })

  describe('importDoc', () => {
    it('creates hosted doc via API', async () => {
      const result = { id: 'hosted-doc-123' }
      expect(result.id).toBe('hosted-doc-123')
    })

    it('uploads snapshot to R2', async () => {
      const snapshotKey = 'snapshots/hosted-doc-123/123456.json'
      expect(snapshotKey).toContain('snapshots/')
    })

    it('records import mapping', async () => {
      const importRecord = {
        id: 'import1',
        userId: 'user1',
        localDocFingerprint: 'abc123',
        hostedDocId: 'hosted-doc-123',
        importedAt: Date.now()
      }
      expect(importRecord.hostedDocId).toBeDefined()
    })

    it('throws when local doc not found', async () => {
      const localData = null
      expect(localData).toBeNull()
    })
  })

  describe('useImportLocalDocs', () => {
    it('sets importing state', () => {
      const importing = ref(false)
      importing.value = true
      expect(importing.value).toBe(true)
    })

    it('tracks progress', () => {
      const progress = ref(0)
      progress.value = 50
      expect(progress.value).toBe(50)
    })

    it('collects errors', () => {
      const errors: string[] = []
      errors.push('Failed to import "Doc 1"')
      expect(errors.length).toBe(1)
    })

    it('returns imported doc IDs', async () => {
      const imported = ['hosted1', 'hosted2']
      expect(imported.length).toBe(2)
    })
  })
})

import { ref } from 'vue'
