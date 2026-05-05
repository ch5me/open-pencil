import { ref, computed, readonly } from 'vue'
import type { DocumentPersistenceAdapter } from '../lib/persistence/DocumentPersistenceAdapter'

const persistenceAdapter = ref<DocumentPersistenceAdapter | null>(null)
const hostedAuthSession = ref<{ userId: string; email: string } | null>(null)
const recentDocuments = ref<Array<{ id: string; title: string; updatedAt: number }>>([])

export function usePersistenceAdapter() {
  function setAdapter(adapter: DocumentPersistenceAdapter) {
    persistenceAdapter.value = adapter
  }

  async function saveDocument(id: string, data: string): Promise<void> {
    if (!persistenceAdapter.value) return
    await persistenceAdapter.value.saveDocument(id, data)
  }

  async function loadDocument(id: string): Promise<string | null> {
    if (!persistenceAdapter.value) return null
    return persistenceAdapter.value.loadDocument(id)
  }

  async function deleteDocument(id: string): Promise<void> {
    if (!persistenceAdapter.value) return
    await persistenceAdapter.value.deleteDocument(id)
  }

  return { setAdapter, saveDocument, loadDocument, deleteDocument }
}

export function useHostedAuth() {
  function setHostedSession(session: { userId: string; email: string } | null) {
    hostedAuthSession.value = session
  }

  const isAuthenticated = computed(() => hostedAuthSession.value !== null)

  async function signIn(email: string, password: string): Promise<void> {
    const { signIn: authSignIn } = await import('../lib/auth/authTransport')
    const result = await authSignIn(email, password)
    if (result.user) {
      hostedAuthSession.value = { userId: result.user.id, email: result.user.email }
    }
  }

  async function signUp(email: string, password: string, name?: string): Promise<void> {
    const { signUp: authSignUp } = await import('../lib/auth/authTransport')
    const result = await authSignUp(email, password, name)
    if (result.user) {
      hostedAuthSession.value = { userId: result.user.id, email: result.user.email }
    }
  }

  async function signOut(): Promise<void> {
    const { signOut: authSignOut } = await import('../lib/auth/authTransport')
    await authSignOut()
    hostedAuthSession.value = null
  }

  return { setHostedSession, isAuthenticated, signIn, signUp, signOut }
}

export function useRecentDocuments() {
  async function fetchRecent(): Promise<void> {
    try {
      const res = await fetch('/api/documents?limit=20', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        recentDocuments.value = data.documents ?? []
      }
    } catch {
    }
  }

  function addRecent(doc: { id: string; title: string; updatedAt: number }) {
    const idx = recentDocuments.value.findIndex((d) => d.id === doc.id)
    if (idx >= 0) recentDocuments.value.splice(idx, 1)
    recentDocuments.value.unshift(doc)
    if (recentDocuments.value.length > 20) recentDocuments.value.pop()
  }

  return { recentDocuments: readonly(recentDocuments), fetchRecent, addRecent }
}
