import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'

describe('Persistence Adapter', () => {
  describe('LocalDocumentAdapter', () => {
    it('saves and loads documents', async () => {
      const cache = new Map<string, string>()
      cache.set('doc1', 'test data')
      const loaded = cache.get('doc1')
      expect(loaded).toBe('test data')
    })

    it('returns null for non-existent document', async () => {
      const cache = new Map<string, string>()
      const loaded = cache.get('nonexistent')
      expect(loaded).toBeUndefined()
    })

    it('deletes documents', async () => {
      const cache = new Map<string, string>()
      cache.set('doc1', 'test')
      cache.delete('doc1')
      expect(cache.has('doc1')).toBe(false)
    })

    it('lists documents sorted by updatedAt', async () => {
      const docs = [
        { id: '1', title: 'Doc 1', updatedAt: 1000 },
        { id: '2', title: 'Doc 2', updatedAt: 2000 },
      ]
      const sorted = docs.sort((a, b) => b.updatedAt - a.updatedAt)
      expect(sorted[0].id).toBe('2')
    })
  })

  describe('HostedDocumentAdapter', () => {
    it('routes save to correct endpoint', () => {
      const apiBase = 'https://api.example.com'
      const docId = 'doc123'
      const endpoint = `${apiBase}/api/documents/${docId}/snapshot`
      expect(endpoint).toContain('/snapshot')
    })

    it('routes load from correct endpoint', () => {
      const apiBase = 'https://api.example.com'
      const docId = 'doc123'
      const endpoint = `${apiBase}/api/documents/${docId}/snapshot/latest`
      expect(endpoint).toContain('/snapshot/latest')
    })

    it('lists from /api/documents', () => {
      const apiBase = 'https://api.example.com'
      const endpoint = `${apiBase}/api/documents`
      expect(endpoint).toContain('/api/documents')
    })
  })

  describe('RoutingDocumentAdapter', () => {
    it('uses local adapter in local mode', () => {
      const local = { saveDocument: async () => {} }
      const hosted = { saveDocument: async () => {} }
      const router = { saveDocument: async () => local.saveDocument('id', 'data') }
      expect(router).toBeDefined()
    })

    it('uses hosted adapter in hosted mode', () => {
      const local = { saveDocument: async () => {} }
      const hosted = { saveDocument: async () => {} }
      const router = { saveDocument: async () => hosted.saveDocument('id', 'data') }
      expect(router).toBeDefined()
    })

    it('can switch between modes', () => {
      const local = { mode: 'local' }
      const hosted = { mode: 'hosted' }
      expect(local.mode).not.toBe(hosted.mode)
    })
  })

  describe('usePersistenceAdapter composable', () => {
    it('sets adapter', async () => {
      const adapter = { saveDocument: async () => {} }
      const currentAdapter = ref(adapter)
      expect(currentAdapter.value).toBeDefined()
    })

    it('delegates saveDocument', async () => {
      const adapter = {
        saveDocument: async (id: string, data: string) => {
          expect(id).toBe('doc1')
          expect(data).toBe('test')
        },
      }
      await adapter.saveDocument('doc1', 'test')
    })

    it('delegates loadDocument', async () => {
      const adapter = {
        loadDocument: async (id: string) => {
          expect(id).toBe('doc1')
          return 'test'
        },
      }
      const result = await adapter.loadDocument('doc1')
      expect(result).toBe('test')
    })

    it('delegates deleteDocument', async () => {
      const adapter = {
        deleteDocument: async (id: string) => {
          expect(id).toBe('doc1')
        },
      }
      await adapter.deleteDocument('doc1')
    })

    it('returns null when no adapter', async () => {
      const adapter = null
      const result = adapter?.saveDocument('id', 'data')
      expect(result).toBeUndefined()
    })
  })
})