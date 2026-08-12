import type { EditorState } from '@open-pencil/core/editor'

import type { StorageDocumentBinding } from '@/app/integrations/storage/types'
import { persistStorageCanvasLocally } from '@/app/storage/sync/persist'
import { isTauri } from '@/app/tauri/env'

type WriteDocumentState = EditorState & { documentName: string }

export type DocumentWrite = {
  data: Uint8Array
  sceneVersion: number
}

export type DocumentWriteTarget =
  | { storage: StorageDocumentBinding }
  | { path: string }
  | { handle: FileSystemFileHandle }

type DocumentWriterOptions = {
  state: WriteDocumentState
  getFilePath: () => string | null
  getFileHandle: () => FileSystemFileHandle | null
  getStorageBinding: () => StorageDocumentBinding | null
  setSavedVersion: (version: number) => void
  setLastWriteTime: (time: number) => void
}

export function createDocumentWriter({
  state,
  getFilePath,
  getFileHandle,
  getStorageBinding,
  setSavedVersion,
  setLastWriteTime
}: DocumentWriterOptions) {
  return async function writeFile(
    write: DocumentWrite,
    signal?: AbortSignal,
    target?: DocumentWriteTarget
  ): Promise<boolean> {
    signal?.throwIfAborted()
    const resolvedTarget =
      target ??
      (() => {
        const storage = getStorageBinding()
        if (storage) return { storage }
        const path = getFilePath()
        if (path && isTauri()) return { path }
        const handle = getFileHandle()
        return handle ? { handle } : undefined
      })()
    if (!resolvedTarget) return false

    signal?.throwIfAborted()
    setLastWriteTime(Date.now())
    if ('storage' in resolvedTarget) {
      const storage = resolvedTarget.storage
      await persistStorageCanvasLocally({
        providerId: storage.providerId,
        canvasId: storage.documentId,
        name: state.documentName || 'Untitled',
        figBytes: write.data
      })
      signal?.throwIfAborted()
      setSavedVersion(write.sceneVersion)
      return true
    }

    if ('path' in resolvedTarget) {
      const { writeFile: tauriWrite } = await import('@tauri-apps/plugin-fs')
      signal?.throwIfAborted()
      await tauriWrite(resolvedTarget.path, write.data)
      signal?.throwIfAborted()
      setSavedVersion(write.sceneVersion)
      return true
    }

    const writable = await resolvedTarget.handle.createWritable()
    signal?.throwIfAborted()
    await writable.write(new Uint8Array(write.data))
    await writable.close()
    signal?.throwIfAborted()
    setSavedVersion(write.sceneVersion)
    return true
  }
}
