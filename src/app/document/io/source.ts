import type { Editor, EditorState } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { canUseRasterExportWorker } from '@open-pencil/core/io/formats/raster'

import { createAbortableSaveOperation, createAutosave } from '@/app/document/autosave/create'
import {
  documentNameFromFigPath,
  downloadNameFromPath,
  figDownloadName
} from '@/app/document/io/names'
import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import type { DocumentWrite } from '@/app/document/io/write'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

export { createDocumentSourceState }

function isExpectedSaveCancellation(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'IOCancelledError' || error.name === 'AbortError')
  )
}

export function observeSaveAction<T>(result: Promise<T>): Promise<T> {
  void result.catch((error) => {
    if (!isExpectedSaveCancellation(error)) console.error('Save failed:', error)
  })
  return result
}

type DocumentSourceOptions = DocumentSourceAccess & {
  editor: Editor
  state: DocumentSourceState
  stopWatchingFile: () => void
  startWatchingFile: () => Promise<void>
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
  getStorageBinding,
  setStorageBinding,
  setSourceIdentity,
  getSavedVersion,
  setSavedVersion,
  setLastWriteTime,
  getRenderer
}: DocumentSourceOptions) {
  const saveOperation = createAbortableSaveOperation()

  async function buildFigFile(signal?: AbortSignal): Promise<DocumentWrite> {
    signal?.throwIfAborted()
    const sceneVersion = state.sceneVersion
    const renderer = canUseRasterExportWorker() ? undefined : (getRenderer() ?? undefined)
    const data = await exportFigFile(
      editor.graph,
      undefined,
      renderer,
      state.currentPageId,
      false,
      signal
    )
    signal?.throwIfAborted()
    return { data, sceneVersion }
  }

  const {
    saveFigFile: saveFigFileUncontrolled,
    saveFigFileAs: saveFigFileAsUncontrolled,
    writeFile
  } = createSaveActions({
    state,
    buildFigFile,
    getFilePath,
    setFilePath,
    getFileHandle,
    setFileHandle,
    getDownloadName,
    setDownloadName,
    getStorageBinding,
    setStorageBinding,
    setSourceIdentity,
    setSavedVersion,
    setLastWriteTime,
    startWatchingFile: () => {
      void startWatchingFile()
    }
  })

  function runSave<T>(save: (signal: AbortSignal) => Promise<T>) {
    return saveOperation.run(save)
  }

  const saveFigFile = () => observeSaveAction(runSave(saveFigFileUncontrolled))
  const saveFigFileAs = () => observeSaveAction(runSave(saveFigFileAsUncontrolled))

  const { disposeAutosave } = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding(),
    saveCurrentDocument: () =>
      runSave(async (signal) => void (await writeFile(await buildFigFile(signal), signal)))
  })

  function setDocumentSource(
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) {
    saveOperation.dispose()
    stopWatchingFile()
    setStorageBinding(null)
    const isFig = sourceFormat === 'fig'
    setFileHandle(isFig ? (handle ?? null) : null)
    setFilePath(isFig ? (path ?? null) : null)
    setDownloadName(figDownloadName(fileName, sourceFormat))
    setSourceIdentity({ handle: handle ?? null, path: path ?? null })
    setSavedVersion(state.sceneVersion)
    if (isFig && (handle || path)) {
      void startWatchingFile()
    }
  }

  function setStorageDocumentSource(binding: StorageDocumentBinding, documentName: string) {
    saveOperation.dispose()
    stopWatchingFile()
    setFileHandle(null)
    setFilePath(null)
    setDownloadName(`${documentName}.fig`)
    setSourceIdentity({ handle: null, path: null })
    setStorageBinding(binding)
    state.documentName = documentName
    state.autosaveEnabled = true
    setSavedVersion(state.sceneVersion)
  }

  function setPlannedFilePath(path: string) {
    saveOperation.dispose()
    stopWatchingFile()
    setStorageBinding(null)
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
    saveOperation.dispose()
  }

  return {
    setDocumentSource,
    setStorageDocumentSource,
    setPlannedFilePath,
    startWatchingCurrentFile,
    disposeDocumentIO,
    saveFigFile,
    saveFigFileAs,
    getStorageBinding
  }
}
