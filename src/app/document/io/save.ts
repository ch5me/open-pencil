import type { EditorState } from '@open-pencil/core/editor'
import { dialogMessages } from '@open-pencil/vue'

import { downloadBlob } from '@/app/document/io/browser'
import { documentNameFromFigPath } from '@/app/document/io/names'
import { chooseBrowserFigSaveHandle, chooseTauriFigSavePath } from '@/app/document/io/save-targets'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import {
  createDocumentWriter,
  type DocumentWrite,
  type DocumentWriteTarget
} from '@/app/document/io/write'
import { IS_TAURI } from '@/constants'

type SaveDocumentState = EditorState & { documentName: string }

type SaveActionsOptions = Omit<DocumentSourceAccess, 'getSavedVersion'> & {
  state: SaveDocumentState
  buildFigFile: (signal?: AbortSignal) => DocumentWrite | Promise<DocumentWrite>
  startWatchingFile: () => void
}

export function createSaveActions({
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
  startWatchingFile
}: SaveActionsOptions) {
  const writeFile = createDocumentWriter({
    state,
    getFilePath,
    getFileHandle,
    getStorageBinding,
    setSavedVersion,
    setLastWriteTime
  })

  async function saveFigFile(signal?: AbortSignal) {
    signal?.throwIfAborted()
    const filePath = getFilePath()
    const fileHandle = getFileHandle()
    const storageBinding = getStorageBinding()
    const downloadName = getDownloadName()
    if (storageBinding || filePath || fileHandle) {
      let target: DocumentWriteTarget | undefined
      if (storageBinding) target = { storage: storageBinding }
      else if (filePath && IS_TAURI) target = { path: filePath }
      else if (fileHandle) target = { handle: fileHandle }
      const wrote = await writeFile(await buildFigFile(signal), signal, target)
      signal?.throwIfAborted()
      if (wrote && !storageBinding) setSourceIdentity({ handle: fileHandle, path: filePath })
    } else if (downloadName) {
      const write = await buildFigFile(signal)
      signal?.throwIfAborted()
      downloadBlob(new Uint8Array(write.data), downloadName, 'application/octet-stream')
    } else {
      await saveFigFileAs(signal)
    }
  }

  async function saveFigFileAs(signal?: AbortSignal) {
    const write = await buildFigFile(signal)
    signal?.throwIfAborted()

    if (IS_TAURI) {
      const path = await chooseTauriFigSavePath()
      if (!path) return
      signal?.throwIfAborted()
      if (!(await writeFile(write, signal, { path }))) return
      signal?.throwIfAborted()
      setStorageBinding(null)
      setFilePath(path)
      setFileHandle(null)
      state.documentName = documentNameFromFigPath(path)
      setSourceIdentity({ handle: null, path })
      signal?.throwIfAborted()
      startWatchingFile()
      return
    }

    if (window.showSaveFilePicker) {
      const handle = await chooseBrowserFigSaveHandle()
      if (!handle) return
      signal?.throwIfAborted()
      if (!(await writeFile(write, signal, { handle }))) return
      signal?.throwIfAborted()
      setStorageBinding(null)
      setFileHandle(handle)
      setFilePath(null)
      state.documentName = documentNameFromFigPath(handle.name)
      setSourceIdentity({ handle, path: null })
      signal?.throwIfAborted()
      startWatchingFile()
      return
    }

    signal?.throwIfAborted()
    const filename = prompt(dialogMessages.get().saveAsPrompt, getDownloadName() ?? 'Untitled.fig')
    if (!filename) return
    signal?.throwIfAborted()
    downloadBlob(new Uint8Array(write.data), filename, 'application/octet-stream')
    signal?.throwIfAborted()
    setStorageBinding(null)
    setDownloadName(filename)
    state.documentName = documentNameFromFigPath(filename)
  }

  return { saveFigFile, saveFigFileAs, writeFile }
}
