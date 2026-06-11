import type { Editor, EditorState } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'

import { createAutosave } from '@/app/document/autosave'
import type { DocumentBackend } from '@/app/document/io/backend'
import {
  createHostedDocumentBackend,
  type HostedDocumentClient,
  type HostedDocumentDescriptor
} from '@/app/document/io/hosted-backend'
import {
  createLocalDocumentBackend,
  type LocalDocumentBackendOptions
} from '@/app/document/io/local-backend'
import {
  documentNameFromFigPath,
  downloadNameFromPath,
  figDownloadName
} from '@/app/document/io/names'
import { createDocumentSourceState } from '@/app/document/io/source-state'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

export type BackendChoice =
  | { kind: 'local' }
  | { kind: 'hosted'; descriptor: HostedDocumentDescriptor | null; client?: HostedDocumentClient }

export { createDocumentSourceState }

function resolveBackend(choice: BackendChoice, localOptions: LocalDocumentBackendOptions): DocumentBackend {
  if (choice.kind === 'hosted') {
    return createHostedDocumentBackend({
      descriptor: choice.descriptor,
      client: choice.client
    })
  }
  return createLocalDocumentBackend(localOptions)
}

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
  getSavedVersion: () => number
  setSavedVersion: (version: number) => void
  setLastWriteTime: (time: number) => void
  getRenderer: () => Editor['renderer']
  backendChoice?: BackendChoice
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
  getSavedVersion,
  setSavedVersion,
  setLastWriteTime,
  getRenderer,
  backendChoice = { kind: 'local' }
}: DocumentSourceOptions) {
  function buildFigFile() {
    return exportFigFile(editor.graph, undefined, getRenderer() ?? undefined, state.currentPageId)
  }

  const localOptions: LocalDocumentBackendOptions = {
    state,
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
  }

  const documentBackend: DocumentBackend = resolveBackend(backendChoice, localOptions)

  const { disposeAutosave } = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource: () =>
      documentBackend.hasCapability('localFileSave') && (!!getFileHandle() || !!getFilePath()),
    saveCurrentDocument: async () => documentBackend.autosave(await buildFigFile())
  })

  async function saveFigFile() {
    await documentBackend.save(await buildFigFile())
  }

  async function saveFigFileAs() {
    await documentBackend.saveAs(await buildFigFile())
  }

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
    const downloadName = downloadNameFromPath(path)
    setDownloadName(downloadName)
    state.documentName = documentNameFromFigPath(downloadName)
  }

  function startWatchingCurrentFile() {
    void startWatchingFile()
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
    documentBackend,
    saveFigFile,
    saveFigFileAs
  }
}
