import { LocalDocumentAdapter } from './DocumentPersistenceAdapter'

export class LocalDocImporter {
  constructor(private localAdapter: LocalDocumentAdapter) {}

  async detectLocalDocs(): Promise<Array<{ id: string; title: string; fingerprint: string }>> {
    const docs = await this.localAdapter.listDocuments()
    return Promise.all(
      docs.map(async (doc) => ({
        id: doc.id,
        title: doc.title,
        fingerprint: await this.computeFingerprint(doc.id),
      }))
    )
  }

  async importDoc(docId: string, apiBase: string): Promise<string> {
    const data = await this.localAdapter.loadDocument(docId)
    if (!data) throw new Error('Document not found locally')

    const fingerprint = await this.computeFingerprint(docId)

    const res = await fetch(`${apiBase}/api/documents`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Imported Document' }),
    })
    if (!res.ok) throw new Error('Failed to create hosted document')
    const { id: hostedId } = await res.json()

    await fetch(`${apiBase}/api/documents/${hostedId}/snapshot`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    })

    await fetch(`${apiBase}/api/documents/imports`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localDocFingerprint: fingerprint, hostedDocId: hostedId }),
    })

    return hostedId
  }

  private async computeFingerprint(docId: string): Promise<string> {
    const stored = await this.localAdapter.loadDocument(docId)
    if (!stored) return docId
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stored))
    return btoa(String.fromCharCode(...new Uint8Array(hashBuffer))).slice(0, 32)
  }
}
