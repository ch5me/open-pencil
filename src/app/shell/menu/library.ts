import { ref, computed, readonly } from 'vue'

import { openFileInNewTab } from '@/app/tabs'
import { API_BASE_URL } from '@/lib/auth/authTransport'
import { useHostedSession } from '@/lib/auth/use-hosted-session'

export interface CloudDocument {
  id: string
  title: string
  updatedAt: number
}

const cloudDocuments = ref<CloudDocument[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

export function useCloudDocuments() {
  const hostedSession = useHostedSession()

  const isSignedIn = computed(() => hostedSession.isSignedIn.value)

  async function fetchDocuments(): Promise<void> {
    if (!isSignedIn.value) {
      cloudDocuments.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      const res = await fetch(`${API_BASE_URL}/api/documents?limit=50`, {
        credentials: 'include'
      })
      if (!res.ok) throw new Error('Failed to load documents')
      const data = (await res.json()) as { documents?: CloudDocument[] }
      cloudDocuments.value = data.documents ?? []
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      cloudDocuments.value = []
    } finally {
      loading.value = false
    }
  }

  async function openCloudDocument(documentId: string): Promise<void> {
    const doc = cloudDocuments.value.find((d) => d.id === documentId)
    const title = doc?.title ?? 'Untitled'

    const [docRes, snapshotRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/documents/${documentId}`, { credentials: 'include' }),
      fetch(`${API_BASE_URL}/api/documents/${documentId}/snapshot/latest`, {
        credentials: 'include'
      })
    ])
    if (!docRes.ok || !snapshotRes.ok) {
      throw new Error('Failed to load document')
    }

    const snapshotJson = (await snapshotRes.json()) as { data?: string }
    if (!snapshotJson.data) throw new Error('No snapshot data')

    const binary = atob(snapshotJson.data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)

    const copiedBuffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(copiedBuffer).set(bytes)
    const file = new File([copiedBuffer], `${title}.fig`)
    await openFileInNewTab(file, undefined, undefined)
  }

  return {
    documents: readonly(cloudDocuments),
    loading: readonly(loading),
    error: readonly(error),
    isSignedIn,
    fetchDocuments,
    openCloudDocument
  }
}
