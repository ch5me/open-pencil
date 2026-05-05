import { ref } from 'vue'
import { API_BASE_URL } from '../auth/authTransport'

export function useShareDialog() {
  const open = ref(false)
  const documentId = ref('')
  const shareLink = ref('')
  const members = ref<Array<{ id: string; email?: string; name?: string; role: string }>>([])
  const loading = ref(false)
  const errors = ref<string[]>([])

  function openDialog(docId: string) {
    documentId.value = docId
    open.value = true
    errors.value = []
    void loadMembers()
  }

  function closeDialog() {
    open.value = false
    shareLink.value = ''
    members.value = []
  }

  async function createLink(role = 'viewer') {
    loading.value = true
    errors.value = []
    try {
      const res = await fetch(`${API_BASE_URL}/api/share/links`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId: documentId.value, role }),
      })
      if (!res.ok) throw new Error('Failed to create share link')
      const data = await res.json()
      shareLink.value = `${window.location.origin}/share/${data.token}`
    } catch (err) {
      errors.value.push(String(err))
    } finally {
      loading.value = false
    }
  }

  async function copyLink() {
    if (!shareLink.value) return
    await navigator.clipboard.writeText(shareLink.value)
  }

  async function loadMembers() {
    if (!documentId.value) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/share/documents/${documentId.value}/members`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Failed to load members')
      const data = await res.json()
      members.value = data.members ?? []
    } catch (err) {
      errors.value.push(String(err))
    }
  }

  return { open, documentId, shareLink, members, loading, errors, openDialog, closeDialog, createLink, copyLink, loadMembers }
}
