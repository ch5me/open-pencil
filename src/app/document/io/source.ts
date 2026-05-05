import { createAutosave } from '@/app/document/autosave'
import { API_BASE_URL } from '@/lib/auth/authTransport'
import { useHostedSession } from '@/lib/auth/use-hosted-session'
import {
  documentNameFromFigPath,
  downloadNameFromPath,
  figDownloadName
} from '@/app/document/io/names'
import { createSaveActions } from '@/app/document/io/save'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import { createDocumentSourceState } from '@/app/document/io/source-state'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { readFigFile } from '@open-pencil/core/io/formats/fig'

import type { Editor, EditorState } from '@open-pencil/core/editor'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

export { createDocumentSourceState }

type DocumentSourceOptions = {
  editor: Editor
  state: DocumentSourceState
  stopWatchingFile: () => void
  startWatchingFile: () => Promise<void>
  getFileHandle: () => FileSystemFileHandle | null
  setFileHandle: (handle: FileSystemFileHandle | null) => void
  getFilePath: () => string | null
  setFilePath: (path: string | null) => void
  getDownloadName: () => string | null
  setDownloadName: (name: string | null) => void
  getHostedDocumentId: () => string | null
  setHostedDocumentId: (id: string | null) => void
  getSavedVersion: () => number
  setSavedVersion: (version: number) => void
  setLastWriteTime: (time: number) => void
  getRenderer: () => Editor['renderer']
}

export function createDocumentSourceActions({
  editor,
  state,
  stopWatchingFile,
  startWatchingFile,
  getFileHandle,
  setFileHandle,
  getFilePath,
  setFilePath,
  getDownloadName,
  setDownloadName,
  getHostedDocumentId,
  setHostedDocumentId,
  getSavedVersion,
  setSavedVersion,
  setLastWriteTime,
  getRenderer
}: DocumentSourceOptions) {
  const hostedSession = useHostedSession()
  const HOSTED_DOC_KEY_PREFIX = 'open-pencil:hosted-current-doc:'

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
  }

  function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  async function getHostedUser() {
    return hostedSession.user.value
  }

  async function getHostedCurrentDocumentKey() {
    const user = await getHostedUser()
    return user ? `${HOSTED_DOC_KEY_PREFIX}${user.id}` : null
  }

  async function rememberHostedDocumentId(documentId: string) {
    const key = await getHostedCurrentDocumentKey()
    if (!key || typeof localStorage === 'undefined') return
    localStorage.setItem(key, documentId)
  }

  async function recallHostedDocumentId() {
    const key = await getHostedCurrentDocumentKey()
    if (!key || typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  }

  async function saveHostedDocument(figBytes: Uint8Array) {
    const user = await getHostedUser()
    if (!user) {
      await saveFigFileAs()
      return
    }

    let hostedDocumentId = getHostedDocumentId()
    if (!hostedDocumentId) {
      const createRes = await fetch(`${API_BASE_URL}/api/documents`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: state.documentName || 'Untitled' })
      })
      if (!createRes.ok) throw new Error('Failed to create hosted document')
      const created = await createRes.json() as { id: string; title?: string }
      hostedDocumentId = created.id
      setHostedDocumentId(hostedDocumentId)
      setFileHandle(null)
      setFilePath(null)
      setDownloadName(null)
      state.autosaveEnabled = true
      state.documentName = created.title ?? state.documentName
    }

    const snapshotRes = await fetch(`${API_BASE_URL}/api/documents/${hostedDocumentId}/snapshot`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: bytesToBase64(figBytes) })
    })
    if (!snapshotRes.ok) throw new Error('Failed to save hosted document')

    await fetch(`${API_BASE_URL}/api/documents/${hostedDocumentId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: state.documentName })
    })

    await rememberHostedDocumentId(hostedDocumentId)
    setSavedVersion(state.sceneVersion)
    setLastWriteTime(Date.now())
  }

  async function restoreHostedDocument(documentId: string) {
    const [docRes, snapshotRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/documents/${documentId}`, { credentials: 'include' }),
      fetch(`${API_BASE_URL}/api/documents/${documentId}/snapshot/latest`, { credentials: 'include' })
    ])
    if (!docRes.ok || !snapshotRes.ok) return false

    const docJson = await docRes.json() as { document?: { id: string; title?: string } }
    const snapshotJson = await snapshotRes.json() as { data?: string }
    if (!snapshotJson.data) return false

    const bytes = base64ToBytes(snapshotJson.data)
    const file = new File([bytes], `${docJson.document?.title ?? 'Untitled'}.fig`)
    const imported = await readFigFile(file, { populate: 'first-page' })
    await applyImportedDocument(editor, imported)
    setHostedDocumentId(documentId)
    setFileHandle(null)
    setFilePath(null)
    setDownloadName(null)
    state.documentName = docJson.document?.title ?? 'Untitled'
    state.autosaveEnabled = true
    setSavedVersion(state.sceneVersion)
    await rememberHostedDocumentId(documentId)
    editor.requestRender()
    return true
  }

  function buildFigFile() {
    return exportFigFile(editor.graph, undefined, getRenderer() ?? undefined, state.currentPageId)
  }

  const { saveFigFile, saveFigFileAs, writeFile } = createSaveActions({
    state,
    buildFigFile,
    getFilePath,
    setFilePath,
    getFileHandle,
    setFileHandle,
    getDownloadName,
    setDownloadName,
    setSavedVersion,
    setLastWriteTime,
    startWatchingFile: () => {
      void startWatchingFile()
    }
  })

  async function saveCurrentDocument() {
    const data = await buildFigFile()
    if (getHostedDocumentId()) {
      await saveHostedDocument(data)
      return
    }

    const user = await getHostedUser()
    if (user && !getFileHandle() && !getFilePath()) {
      await saveHostedDocument(data)
      return
    }

    await saveFigFile()
  }

  const { disposeAutosave } = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getHostedDocumentId() || hostedSession.isSignedIn.value,
    saveCurrentDocument
  })

  function setDocumentSource(
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) {
    stopWatchingFile()
    const isFig = sourceFormat === 'fig'
    setFileHandle(isFig ? (handle ?? null) : null)
    setFilePath(isFig ? (path ?? null) : null)
    setHostedDocumentId(null)
    setDownloadName(figDownloadName(fileName, sourceFormat))
    setSavedVersion(state.sceneVersion)
    if (isFig && (handle || path)) {
      void startWatchingFile()
    }
  }

  function setPlannedFilePath(path: string) {
    stopWatchingFile()
    setFileHandle(null)
    setFilePath(path)
    setHostedDocumentId(null)
    const downloadName = downloadNameFromPath(path)
    setDownloadName(downloadName)
    state.documentName = documentNameFromFigPath(downloadName)
  }

  function startWatchingCurrentFile() {
    void startWatchingFile()
  }

  async function restoreHostedSessionDocument() {
    const rememberedId = await recallHostedDocumentId()
    if (!rememberedId) return false
    return restoreHostedDocument(rememberedId)
  }

  function hasUnsavedChanges() {
    return state.sceneVersion !== getSavedVersion()
  }

  function hasHostedDocumentSource() {
    return !!getHostedDocumentId()
  }

  async function canUseHostedSave() {
    if (getHostedDocumentId()) return true
    const user = await getHostedUser()
    return !!user && !getFileHandle() && !getFilePath()
  }

  function disposeDocumentIO() {
    stopWatchingFile()
    disposeAutosave()
  }

  return {
    setDocumentSource,
    setPlannedFilePath,
    startWatchingCurrentFile,
    disposeDocumentIO,
    saveFigFile: saveCurrentDocument,
    saveFigFileAs,
    restoreHostedSessionDocument,
    hasUnsavedChanges,
    hasHostedDocumentSource,
    canUseHostedSave
  }
}
