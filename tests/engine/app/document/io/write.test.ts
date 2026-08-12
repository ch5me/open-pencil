import { afterEach, describe, expect, test, vi } from 'bun:test'

import { createDefaultEditorState } from '@open-pencil/core/editor'

import { createDocumentWriter } from '@/app/document/io/write'

import { clearTauriMocks, mockTauriIPC } from '#tests/helpers/tauri/mocks'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function createWriter(setSavedVersion = vi.fn()) {
  return {
    setSavedVersion,
    write: createDocumentWriter({
      state: {
        ...createDefaultEditorState('page'),
        documentName: 'Untitled'
      },
      getFilePath: () => null,
      getFileHandle: () => null,
      getStorageBinding: () => null,
      setSavedVersion,
      setLastWriteTime: vi.fn()
    })
  }
}

afterEach(async () => {
  await clearTauriMocks()
})

describe('document persistence', () => {
  test('cancellation during browser persistence aborts the writable without publishing', async () => {
    const writing = deferred()
    const started = deferred()
    const abort = vi.fn(async () => {
      writing.reject(new DOMException('Save aborted', 'AbortError'))
    })
    const close = vi.fn(async () => undefined)
    const writeBytes = vi.fn(() => {
      started.resolve(undefined)
      return writing.promise
    })
    const createWritable = vi.fn(async () => ({
      write: writeBytes,
      close,
      abort
    }))
    const handle = {
      createWritable
    } as FileSystemFileHandle
    const controller = new AbortController()
    const { setSavedVersion, write } = createWriter()

    const saving = write({ data: new Uint8Array([1]), sceneVersion: 1 }, controller.signal, {
      handle
    })
    await started.promise
    controller.abort()

    await expect(saving).rejects.toMatchObject({ name: 'AbortError' })
    expect(abort).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
    expect(setSavedVersion).not.toHaveBeenCalled()
  })

  test('a superseded browser write aborts instead of committing stale bytes', async () => {
    const firstWrite = deferred()
    const firstAbort = vi.fn(async () => {
      firstWrite.reject(new DOMException('Save superseded', 'AbortError'))
    })
    const firstClose = vi.fn(async () => undefined)
    const secondClose = vi.fn(async () => undefined)
    const createWritable = vi
      .fn()
      .mockResolvedValueOnce({
        write: vi.fn(() => firstWrite.promise),
        close: firstClose,
        abort: firstAbort
      })
      .mockResolvedValueOnce({
        write: vi.fn(async () => undefined),
        close: secondClose,
        abort: vi.fn(async () => undefined)
      })
    const handle = {
      createWritable
    } as FileSystemFileHandle
    const { setSavedVersion, write } = createWriter()

    const stale = write({ data: new Uint8Array([1]), sceneVersion: 1 }, undefined, { handle })
    while (createWritable.mock.calls.length === 0) await Promise.resolve()
    const latest = write({ data: new Uint8Array([2]), sceneVersion: 2 }, undefined, { handle })
    firstWrite.resolve()

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    await latest
    expect(firstAbort).toHaveBeenCalled()
    expect(firstClose).not.toHaveBeenCalled()
    expect(secondClose).toHaveBeenCalled()
    expect(setSavedVersion).toHaveBeenCalledTimes(1)
    expect(setSavedVersion).toHaveBeenCalledWith(2)
  })

  test('failed replacement leaves no stale saved-version publication', async () => {
    const firstWrite = deferred()
    const firstAbort = vi.fn(async () => {
      firstWrite.resolve()
    })
    const createWritable = vi
      .fn()
      .mockResolvedValueOnce({
        write: vi.fn(() => firstWrite.promise),
        close: vi.fn(async () => undefined),
        abort: firstAbort
      })
      .mockResolvedValueOnce({
        write: vi.fn(async () => {
          throw new Error('replacement failed')
        }),
        close: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined)
      })
    const handle = {
      createWritable
    } as FileSystemFileHandle
    const { setSavedVersion, write } = createWriter()

    const stale = write({ data: new Uint8Array([1]), sceneVersion: 1 }, undefined, { handle })
    void stale.catch(() => undefined)
    while (createWritable.mock.calls.length === 0) await Promise.resolve()
    const replacement = write({ data: new Uint8Array([2]), sceneVersion: 2 }, undefined, {
      handle
    })
    void replacement.catch(() => undefined)
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    await expect(replacement).rejects.toThrow('replacement failed')
    expect(firstAbort).toHaveBeenCalledTimes(1)
    expect(setSavedVersion).not.toHaveBeenCalled()
  })

  test('browser close is an irreversible commit point before a successor starts', async () => {
    const firstClose = deferred()
    const closeStarted = deferred()
    const committed: number[] = []
    const secondWrite = vi.fn(async (bytes: Uint8Array) => {
      committed.push(bytes[0] ?? 0)
    })
    const createWritable = vi
      .fn()
      .mockResolvedValueOnce({
        write: vi.fn(async (bytes: Uint8Array) => {
          committed.push(bytes[0] ?? 0)
        }),
        close: vi.fn(() => {
          closeStarted.resolve()
          return firstClose.promise
        }),
        abort: vi.fn(async () => undefined)
      })
      .mockResolvedValueOnce({
        write: secondWrite,
        close: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined)
      })
    const handle = { createWritable } as FileSystemFileHandle
    const { setSavedVersion, write } = createWriter()

    const stale = write({ data: new Uint8Array([1]), sceneVersion: 1 }, undefined, { handle })
    void stale.catch(() => undefined)
    await closeStarted.promise
    const latest = write({ data: new Uint8Array([2]), sceneVersion: 2 }, undefined, { handle })

    expect(secondWrite).not.toHaveBeenCalled()
    firstClose.resolve()
    await stale
    await latest
    expect(committed).toEqual([1, 2])
    expect(setSavedVersion).toHaveBeenCalledTimes(2)
    expect(setSavedVersion).toHaveBeenNthCalledWith(1, 1)
    expect(setSavedVersion).toHaveBeenCalledWith(2)
  })

  test('failed browser replacement preserves the earlier committed write', async () => {
    const firstClose = deferred()
    const closeStarted = deferred()
    const committed: number[] = []
    const createWritable = vi
      .fn()
      .mockResolvedValueOnce({
        write: vi.fn(async (bytes: Uint8Array) => {
          committed.push(bytes[0] ?? 0)
        }),
        close: vi.fn(() => {
          closeStarted.resolve()
          return firstClose.promise
        }),
        abort: vi.fn(async () => undefined)
      })
      .mockResolvedValueOnce({
        write: vi.fn(async () => {
          throw new Error('replacement failed')
        }),
        close: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined)
      })
    const handle = { createWritable } as FileSystemFileHandle
    const { setSavedVersion, write } = createWriter()

    const stale = write({ data: new Uint8Array([1]), sceneVersion: 1 }, undefined, { handle })
    void stale.catch(() => undefined)
    await closeStarted.promise
    const replacement = write({ data: new Uint8Array([2]), sceneVersion: 2 }, undefined, {
      handle
    })

    firstClose.resolve()
    await stale
    await expect(replacement).rejects.toThrow('replacement failed')
    expect(committed).toEqual([1])
    expect(setSavedVersion).toHaveBeenCalledTimes(1)
    expect(setSavedVersion).toHaveBeenCalledWith(1)
  })

  test('late direct abort during browser close returns committed success', async () => {
    const close = deferred()
    const closeStarted = deferred()
    const abort = vi.fn(async () => undefined)
    const handle = {
      kind: 'file',
      name: 'committed.fig',
      createWritable: vi.fn(async () => ({
        write: vi.fn(async () => undefined),
        close: vi.fn(() => {
          closeStarted.resolve()
          return close.promise
        }),
        abort
      }))
    } satisfies FileSystemFileHandle
    const controller = new AbortController()
    const { setSavedVersion, write } = createWriter()

    const saving = write({ data: new Uint8Array([1]), sceneVersion: 1 }, controller.signal, {
      handle
    })
    await closeStarted.promise
    controller.abort()
    close.resolve()

    await expect(saving).resolves.toBe(true)
    expect(abort).not.toHaveBeenCalled()
    expect(setSavedVersion).toHaveBeenCalledWith(1)
  })

  test('native writes replace the target only from the current generation', async () => {
    const firstWrite = deferred()
    const files = new Map<string, Uint8Array>()
    await mockTauriIPC(async (command, args, options) => {
      if (command === 'plugin:fs|write_file') {
        const path = decodeURIComponent((options as { headers: { path: string } }).headers.path)
        if (path.endsWith('-1.tmp')) await firstWrite.promise
        files.set(path, new Uint8Array(args as ArrayBufferLike))
        return null
      }
      if (command === 'plugin:fs|rename') {
        const { oldPath, newPath } = args as { oldPath: string; newPath: string }
        files.set(newPath, files.get(oldPath) ?? new Uint8Array())
        files.delete(oldPath)
        return null
      }
      if (command === 'plugin:fs|remove') {
        files.delete((args as { path: string }).path)
      }
      return null
    })
    const { setSavedVersion, write } = createWriter()

    const stale = write({ data: new Uint8Array([1]), sceneVersion: 1 }, undefined, {
      path: '/tmp/document.fig'
    })
    const latest = write({ data: new Uint8Array([2]), sceneVersion: 2 }, undefined, {
      path: '/tmp/document.fig'
    })
    firstWrite.resolve()

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    await latest
    expect(files.get('/tmp/document.fig')).toEqual(new Uint8Array([2]))
    expect([...files.keys()].some((path) => path.endsWith('.tmp'))).toBe(false)
    expect(setSavedVersion).toHaveBeenCalledTimes(1)
    expect(setSavedVersion).toHaveBeenCalledWith(2)
  })
})
