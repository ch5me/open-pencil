import { useLocalStorage } from '@vueuse/core'

const localDocStore = useLocalStorage<Record<string, string>>('open-pencil:local-docs', {})
const localDocMetaStore = useLocalStorage<Record<string, { title: string; updatedAt: number }>>(
  'open-pencil:local-doc-meta',
  {}
)

export interface DocumentPersistenceAdapter {
  saveDocument(id: string, data: string): Promise<void>
  loadDocument(id: string): Promise<string | null>
  deleteDocument(id: string): Promise<void>
  listDocuments(): Promise<Array<{ id: string; title: string; updatedAt: number }>>
}

export class LocalDocumentAdapter implements DocumentPersistenceAdapter {
  private cache = new Map<string, string>()

  async saveDocument(id: string, data: string): Promise<void> {
    this.cache.set(id, data)
    localDocStore.value = { ...localDocStore.value, [id]: data }
    if (!localDocMetaStore.value[id]) {
      localDocMetaStore.value = {
        ...localDocMetaStore.value,
        [id]: { title: 'Untitled', updatedAt: Date.now() }
      }
    }
  }

  async loadDocument(id: string): Promise<string | null> {
    return this.cache.get(id) || localDocStore.value[id] || null
  }

  async deleteDocument(id: string): Promise<void> {
    this.cache.delete(id)
    const { [id]: _, ...docs } = localDocStore.value
    const { [id]: __, ...meta } = localDocMetaStore.value
    localDocStore.value = docs
    localDocMetaStore.value = meta
  }

  async listDocuments(): Promise<Array<{ id: string; title: string; updatedAt: number }>> {
    const docs = Object.keys(localDocStore.value).map((id) => ({
      id,
      title: localDocMetaStore.value[id]?.title ?? 'Untitled',
      updatedAt: localDocMetaStore.value[id]?.updatedAt ?? 0
    }))
    return docs.sort((a, b) => b.updatedAt - a.updatedAt)
  }
}

export class HostedDocumentAdapter implements DocumentPersistenceAdapter {
  constructor(private apiBase: string) {}

  async saveDocument(id: string, data: string): Promise<void> {
    await fetch(`${this.apiBase}/api/documents/${id}/snapshot`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data })
    })
  }

  async loadDocument(id: string): Promise<string | null> {
    const res = await fetch(`${this.apiBase}/api/documents/${id}/snapshot/latest`, {
      credentials: 'include'
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  }

  async deleteDocument(id: string): Promise<void> {
    await fetch(`${this.apiBase}/api/documents/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
  }

  async listDocuments(): Promise<Array<{ id: string; title: string; updatedAt: number }>> {
    const res = await fetch(`${this.apiBase}/api/documents`, { credentials: 'include' })
    if (!res.ok) return []
    const json = await res.json()
    return json.documents ?? []
  }
}

export class RoutingDocumentAdapter implements DocumentPersistenceAdapter {
  constructor(
    private local: LocalDocumentAdapter,
    private hosted: HostedDocumentAdapter,
    private isLocal = true
  ) {}

  setLocalMode(local: boolean) {
    this.isLocal = local
  }

  async saveDocument(id: string, data: string): Promise<void> {
    return this.isLocal ? this.local.saveDocument(id, data) : this.hosted.saveDocument(id, data)
  }

  async loadDocument(id: string): Promise<string | null> {
    return this.isLocal ? this.local.loadDocument(id) : this.hosted.loadDocument(id)
  }

  async deleteDocument(id: string): Promise<void> {
    return this.isLocal ? this.local.deleteDocument(id) : this.hosted.deleteDocument(id)
  }

  async listDocuments(): Promise<Array<{ id: string; title: string; updatedAt: number }>> {
    return this.isLocal ? this.local.listDocuments() : this.hosted.listDocuments()
  }
}
