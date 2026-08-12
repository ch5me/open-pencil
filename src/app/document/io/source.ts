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
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

export { createDocumentSourceState }

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
  let currentSaveSignal: AbortSignal | undefined

  async function buildFigFile(signal = currentSaveSignal) {
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
    return data
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

  function runSave<T>(save: () => Promise<T>) {
    return saveOperation.run(async (signal) => {
      currentSaveSignal = signal
      try {
        return await save()
      } finally {
        currentSaveSignal = undefined
      }
    })
  }

  const saveFigFile = () => runSave(saveFigFileUncontrolled)
  const saveFigFileAs = () => runSave(saveFigFileAsUncontrolled)

  const { disposeAutosave } = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding(),
    saveCurrentDocument: () => runSave(async () => void (await writeFile(await buildFigFile())))
  })

  function setDocumentSource(
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) {
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
