import type { EditorState } from '@open-pencil/core/editor'
import { readFigFile } from '@open-pencil/core/io/formats/fig'

import {
  type DocumentBackend,
  DocumentBackendOperationError,
  type DocumentBackendMetadata,
  type DocumentOpenRequest,
  type DocumentOpenResult,
  createCapabilityPolicies,
  createOperationPolicies,
  requireDocumentBackendOperation
} from '@/app/document/io/backend'
import { downloadBlob, yieldToUI } from '@/app/document/io/browser'
import { documentNameFromFigPath } from '@/app/document/io/names'
import { readReloadSource } from '@/app/document/io/reload-source'
import { chooseBrowserFigSaveHandle, chooseTauriFigSavePath } from '@/app/document/io/save-targets'
import { createDocumentWriter } from '@/app/document/io/write'
import { IS_TAURI } from '@/constants'

type LocalDocumentBackendState = EditorState & { documentName: string }

export type LocalDocumentBackendOptions = {
  state: LocalDocumentBackendState
  getFilePath: () => string | null
  setFilePath: (path: string | null) => void
  getFileHandle: () => FileSystemFileHandle | null
  setFileHandle: (handle: FileSystemFileHandle | null) => void
  getDownloadName: () => string | null
  setDownloadName: (name: string | null) => void
  setSavedVersion: (version: number) => void
  setLastWriteTime: (time: number) => void
  startWatchingFile: () => void
}

export function createLocalDocumentBackend({
  state,
  getFilePath,
  setFilePath,
  getFileHandle,
  setFileHandle,
  getDownloadName,
  setDownloadName,
  setSavedVersion,
  setLastWriteTime,
  startWatchingFile
}: LocalDocumentBackendOptions): DocumentBackend {
  const writeFile = createDocumentWriter({
    state,
    getFilePath,
    getFileHandle,
    setSavedVersion,
    setLastWriteTime
  })
  const backend: DocumentBackend = {
    id: 'local-file',
    mode: 'local-only',
    operations: createOperationPolicies(),
    capabilities: createCapabilityPolicies([
      'localFileOpen',
      'localFileSave',
      'browserDownloadFallback',
      'metadataLoad'
    ]),
    can: (operation) => backend.operations[operation].legal,
    hasCapability: (capability) => backend.capabilities[capability].supported,
    getMetadata,
    loadMetadata: async () => getMetadata(),
    open,
    save,
    saveAs,
    autosave
  }

  function getMetadata(): DocumentBackendMetadata {
    return {
      mode: backend.mode,
      displayName: state.documentName,
      sourceFormat: 'fig',
      local: {
        filePath: getFilePath(),
        fileHandleName: getFileHandle()?.name ?? null,
        downloadName: getDownloadName()
      }
    }
  }

  async function open(request: DocumentOpenRequest): Promise<DocumentOpenResult | null> {
    requireDocumentBackendOperation(backend, 'open')
    if (request.kind === 'file') {
      await yieldToUI()
      const graph = await readFigFile(request.file, { populate: 'first-page' })
      return {
        graph,
        fileName: request.file.name,
        sourceFormat: 'fig',
        handle: request.handle,
        path: request.path
      }
    }

    const graph = await readReloadSource({
      documentName: state.documentName,
      filePath: getFilePath(),
      fileHandle: getFileHandle()
    })
    if (!graph) return null
    return {
      graph,
      fileName: `${state.documentName}.fig`,
      sourceFormat: 'fig',
      handle: getFileHandle() ?? undefined,
      path: getFilePath() ?? undefined
    }
  }

  async function save(data: Uint8Array) {
    requireDocumentBackendOperation(backend, 'save')
    const filePath = getFilePath()
    const fileHandle = getFileHandle()
    const downloadName = getDownloadName()
    if (filePath || fileHandle) {
      await writeFile(data)
      return
    }
    if (downloadName) {
      downloadBlob(new Uint8Array(data), downloadName, 'application/octet-stream')
      return
    }
    await saveAs(data)
  }

  async function saveAs(data: Uint8Array) {
    requireDocumentBackendOperation(backend, 'saveAs')
    if (IS_TAURI) {
      const path = await chooseTauriFigSavePath()
      if (!path) return
      setFilePath(path)
      setFileHandle(null)
      state.documentName = documentNameFromFigPath(path)
      await writeFile(data)
      startWatchingFile()
      return
    }

    if (window.showSaveFilePicker) {
      const handle = await chooseBrowserFigSaveHandle()
      if (!handle) return
      setFileHandle(handle)
      setFilePath(null)
      state.documentName = documentNameFromFigPath(handle.name)
      await writeFile(data)
      startWatchingFile()
      return
    }

    const filename = prompt('Save as:', getDownloadName() ?? 'Untitled.fig')
    if (!filename) return
    setDownloadName(filename)
    state.documentName = documentNameFromFigPath(filename)
    downloadBlob(new Uint8Array(data), filename, 'application/octet-stream')
  }

  async function autosave(data: Uint8Array) {
    requireDocumentBackendOperation(backend, 'autosave')
    if (!getFilePath() && !getFileHandle()) {
      throw new DocumentBackendOperationError(
        'missing-source',
        'Local autosave requires File System Access handle or Tauri file path.',
        { backendId: backend.id, mode: backend.mode, operation: 'autosave' }
      )
    }
    await writeFile(data)
  }

  return backend
}
