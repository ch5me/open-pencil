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
  let currentGeneration = 0
  let activeAbort: (() => void) | null = null
  let writeTail = Promise.resolve()

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

    const generation = ++currentGeneration
    activeAbort?.()
    const throwIfStale = () => {
      signal?.throwIfAborted()
      if (generation !== currentGeneration) {
        throw new DOMException('Save superseded', 'AbortError')
      }
    }

    const result = writeTail.then(async () => {
      throwIfStale()
      setLastWriteTime(Date.now())
      if ('storage' in resolvedTarget) {
        const storage = resolvedTarget.storage
        await persistStorageCanvasLocally({
          providerId: storage.providerId,
          canvasId: storage.documentId,
          name: state.documentName || 'Untitled',
          figBytes: write.data
        })
        throwIfStale()
        setSavedVersion(write.sceneVersion)
        return true
      }

      if ('path' in resolvedTarget) {
        const { remove, rename, writeFile: tauriWrite } = await import('@tauri-apps/plugin-fs')
        const temporaryPath = `${resolvedTarget.path}.open-pencil-${generation}.tmp`
        try {
          throwIfStale()
          await tauriWrite(temporaryPath, write.data)
          throwIfStale()
          await rename(temporaryPath, resolvedTarget.path)
          throwIfStale()
          setSavedVersion(write.sceneVersion)
          return true
        } catch (error) {
          await remove(temporaryPath).catch(() => undefined)
          throw error
        }
      }

      const writable = await resolvedTarget.handle.createWritable()
      let abortRequested = false
      const abortWritable = () => {
        if (abortRequested) return
        abortRequested = true
        void writable.abort(signal?.reason).catch(() => undefined)
      }
      activeAbort = abortWritable
      signal?.addEventListener('abort', abortWritable, { once: true })
      if (signal?.aborted) abortWritable()
      try {
        throwIfStale()
        await writable.write(new Uint8Array(write.data))
        throwIfStale()
        await writable.close()
        throwIfStale()
        setSavedVersion(write.sceneVersion)
        return true
      } catch (error) {
        abortWritable()
        throw error
      } finally {
        if (activeAbort === abortWritable) activeAbort = null
        signal?.removeEventListener('abort', abortWritable)
      }
    })
    writeTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
