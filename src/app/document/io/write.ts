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
  type WriteOperation = {
    generation: number
    superseded: boolean
    commitInProgress: boolean
    committed: boolean
    abort?: () => void
    successor?: WriteOperation
    completion: Promise<void>
    complete: () => void
    fail: (error: unknown) => void
  }

  let currentGeneration = 0
  let currentOperation: WriteOperation | null = null
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

    let complete!: () => void
    let fail!: (error: unknown) => void
    const completion = new Promise<void>((resolve, reject) => {
      complete = resolve
      fail = reject
    })
    void completion.catch(() => undefined)
    const operation: WriteOperation = {
      generation: ++currentGeneration,
      superseded: false,
      commitInProgress: false,
      committed: false,
      completion,
      complete,
      fail
    }
    if (currentOperation) {
      currentOperation.successor = operation
      if (!currentOperation.committed) {
        currentOperation.superseded = true
        currentOperation.abort?.()
      }
    }
    currentOperation = operation

    const throwIfCancelled = () => {
      signal?.throwIfAborted()
      if (operation.superseded) {
        throw new DOMException('Save superseded', 'AbortError')
      }
    }
    const commitIfCurrent = async <T>(
      commit: (markCommitted: () => void, throwIfCancelled: () => void) => Promise<T>
    ): Promise<T> => {
      throwIfCancelled()
      operation.commitInProgress = true
      try {
        return await commit(() => {
          throwIfCancelled()
          operation.committed = true
        }, throwIfCancelled)
      } finally {
        operation.commitInProgress = false
      }
    }

    const internal = writeTail.then(async () => {
      throwIfCancelled()
      setLastWriteTime(Date.now())
      if ('storage' in resolvedTarget) {
        const storage = resolvedTarget.storage
        await persistStorageCanvasLocally({
          providerId: storage.providerId,
          canvasId: storage.documentId,
          name: state.documentName || 'Untitled',
          figBytes: write.data,
          commitIfCurrent
        })
        if (!operation.superseded) setSavedVersion(write.sceneVersion)
        return true
      }

      if ('path' in resolvedTarget) {
        const { remove, rename, writeFile: tauriWrite } = await import('@tauri-apps/plugin-fs')
        const temporaryPath = `${resolvedTarget.path}.open-pencil-${operation.generation}.tmp`
        try {
          throwIfCancelled()
          await tauriWrite(temporaryPath, write.data)
          await commitIfCurrent((markCommitted) => {
            markCommitted()
            return rename(temporaryPath, resolvedTarget.path)
          })
          if (!operation.superseded) setSavedVersion(write.sceneVersion)
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
      operation.abort = abortWritable
      signal?.addEventListener('abort', abortWritable, { once: true })
      if (signal?.aborted) abortWritable()
      try {
        throwIfCancelled()
        await writable.write(new Uint8Array(write.data))
        throwIfCancelled()
        operation.abort = undefined
        signal?.removeEventListener('abort', abortWritable)
        await commitIfCurrent((markCommitted) => {
          markCommitted()
          return writable.close()
        })
        setSavedVersion(write.sceneVersion)
        return true
      } catch (error) {
        abortWritable()
        throw error
      } finally {
        operation.abort = undefined
        signal?.removeEventListener('abort', abortWritable)
      }
    })
    void internal.then(operation.complete, operation.fail)
    writeTail = internal.then(
      () => undefined,
      () => undefined
    )

    try {
      const result = await internal
      if (!operation.superseded) return result

      let successor = operation.successor
      while (successor) {
        try {
          await successor.completion
        } catch (error) {
          if (
            !(error instanceof DOMException && error.name === 'AbortError' && successor.superseded)
          ) {
            throw error
          }
        }
        successor = successor.successor
      }
      throw new DOMException('Save superseded', 'AbortError')
    } finally {
      if (currentOperation === operation) currentOperation = null
    }
  }
}
