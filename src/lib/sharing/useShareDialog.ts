import { ref } from 'vue'

export function useShareDialog() {
  const open = ref(false)
  const documentId = ref('')
  const shareLink = ref('')
  const loading = ref(false)
  const errors = ref<string[]>([])

  function openDialog(docId: string) {
    documentId.value = docId
    open.value = true
    errors.value = []
  }

  function closeDialog() {
    open.value = false
    shareLink.value = ''
  }

  async function createLink(role = 'viewer') {
    loading.value = true
    errors.value = []
    try {
      const res = await fetch('/api/share/links', {
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

  return { open, documentId, shareLink, loading, errors, openDialog, closeDialog, createLink, copyLink }
}