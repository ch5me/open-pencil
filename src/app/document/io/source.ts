import { useLocalStorage } from '@vueuse/core'

import { createAutosave } from '@/app/document/autosave'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import {
  documentNameFromFigPath,
  downloadNameFromPath,
  figDownloadName
} from '@/app/document/io/names'
import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'
import { API_BASE_URL } from '@/lib/auth/authTransport'
import { useHostedSession } from '@/lib/auth/use-hosted-session'
import { exportFigFile, readFigFile } from '@open-pencil/core/io/formats/fig'

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
  const hostedCurrentDocs = useLocalStorage<Record<string, string>>(
    'open-pencil:hosted-current-docs',
    {}
  )
  let hostedSaveQueue: Promise<void> = Promise.resolve()

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

  function isUntouchedHostedRestoreTarget() {
    return (
      state.documentName === 'Untitled' &&
      state.sceneVersion === getSavedVersion() &&
      !getFileHandle() &&
      !getFilePath() &&
      !getHostedDocumentId()
    )
  }

  async function rememberHostedDocumentId(documentId: string) {
    const key = await getHostedCurrentDocumentKey()
    if (!key) return
    hostedCurrentDocs.value = { ...hostedCurrentDocs.value, [key]: documentId }
  }

  async function recallHostedDocumentId() {
    const key = await getHostedCurrentDocumentKey()
    if (!key) return null
    return hostedCurrentDocs.value[key] ?? null
  }

  async function saveHostedDocument(
    figBytes: Uint8Array,
    savedSceneVersion: number,
    documentTitle: string
  ) {
    let releaseQueue: (() => void) | undefined
    const nextInQueue = new Promise<void>((resolve) => {
      releaseQueue = () => resolve()
    })
    const previousSave = hostedSaveQueue
    hostedSaveQueue = hostedSaveQueue.then(() => nextInQueue)

    await previousSave
    try {
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
          body: JSON.stringify({ title: documentTitle || 'Untitled' })
        })
        if (!createRes.ok) throw new Error('Failed to create hosted document')
        const created = (await createRes.json()) as { id: string; title?: string }
        hostedDocumentId = created.id
        setHostedDocumentId(hostedDocumentId)
        setFileHandle(null)
        setFilePath(null)
        setDownloadName(null)
        state.autosaveEnabled = true
        state.documentName = created.title ?? state.documentName
      }

      const snapshotRes = await fetch(
        `${API_BASE_URL}/api/documents/${hostedDocumentId}/snapshot`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data: bytesToBase64(figBytes), title: documentTitle })
        }
      )
      if (!snapshotRes.ok) throw new Error('Failed to save hosted document')

      const titleRes = await fetch(`${API_BASE_URL}/api/documents/${hostedDocumentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: documentTitle })
      })
      if (!titleRes.ok) {
        console.warn('Hosted document title sync failed', hostedDocumentId)
      }

      await rememberHostedDocumentId(hostedDocumentId)
      if (state.sceneVersion === savedSceneVersion) {
        setSavedVersion(savedSceneVersion)
      }
      setLastWriteTime(Date.now())
    } finally {
      releaseQueue?.()
    }
  }

  async function restoreHostedDocument(documentId: string) {
    const [docRes, snapshotRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/documents/${documentId}`, { credentials: 'include' }),
      fetch(`${API_BASE_URL}/api/documents/${documentId}/snapshot/latest`, {
        credentials: 'include'
      })
    ])
    if (!docRes.ok || !snapshotRes.ok) return false

    const docJson = (await docRes.json()) as { document?: { id: string; title?: string } }
    const snapshotJson = (await snapshotRes.json()) as { data?: string }
    if (!snapshotJson.data) return false

    const bytes = base64ToBytes(snapshotJson.data)
    const copiedBuffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(copiedBuffer).set(bytes)
    const file = new File([copiedBuffer], `${docJson.document?.title ?? 'Untitled'}.fig`)
    const imported = await readFigFile(file, { populate: 'first-page' })
    if (!isUntouchedHostedRestoreTarget()) return false
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

  const { saveFigFile, saveFigFileAs } = createSaveActions({
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
    const savedSceneVersion = state.sceneVersion
    const documentTitle = state.documentName
    const data = await buildFigFile()
    if (getHostedDocumentId()) {
      await saveHostedDocument(data, savedSceneVersion, documentTitle)
      return
    }

    const user = await getHostedUser()
    if (user && !getFileHandle() && !getFilePath()) {
      await saveHostedDocument(data, savedSceneVersion, documentTitle)
      return
    }

    await saveFigFile()
  }

  const { disposeAutosave } = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource: () =>
      !!getFileHandle() ||
      !!getFilePath() ||
      !!getHostedDocumentId() ||
      hostedSession.isSignedIn.value,
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
