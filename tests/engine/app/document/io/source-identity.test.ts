import { afterEach, describe, expect, test, vi } from 'bun:test'

import { createDefaultEditorState } from '@open-pencil/core/editor'

import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

function makeWritableHandle(name: string): FileSystemFileHandle {
  const createWritable = vi.fn(async () => ({
    write: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined)
  }))
  return {
    kind: 'file',
    name,
    createWritable
  } as FileSystemFileHandle
}

function createSaveHarness(handle: FileSystemFileHandle) {
  const state = {
    ...createDefaultEditorState('page'),
    documentName: 'Untitled'
  }
  const setSourceIdentity = vi.fn()
  const setSavedVersion = vi.fn()
  const actions = createSaveActions({
    state,
    buildFigFile: () => ({ data: new Uint8Array([1, 2, 3]), sceneVersion: state.sceneVersion }),
    getFilePath: () => null,
    setFilePath: vi.fn(),
    getFileHandle: () => handle,
    setFileHandle: vi.fn(),
    getDownloadName: () => null,
    setDownloadName: vi.fn(),
    getStorageBinding: () => null,
    setStorageBinding: vi.fn(),
    setSourceIdentity,
    setSavedVersion,
    setLastWriteTime: vi.fn(),
    startWatchingFile: vi.fn()
  })
  return { actions, setSavedVersion, setSourceIdentity }
}

describe('saved document identity', () => {
  test('tracks storage binding alongside local source identity', () => {
    const source = createDocumentSourceState()
    source.setSourceIdentity({ handle: null, path: '/tmp/local.fig' })
    source.setStorageBinding({ providerId: 's3-compatible', documentId: 'remote-1' })

    expect(source.getSourceIdentity()).toEqual({ handle: null, path: '/tmp/local.fig' })
    expect(source.getStorageBinding()).toEqual({
      providerId: 's3-compatible',
      documentId: 'remote-1'
    })
  })

  test('publishes the writable handle after a successful save', async () => {
    const handle = makeWritableHandle('saved.fig')
    const { actions, setSourceIdentity } = createSaveHarness(handle)

    await actions.saveFigFile()

    expect(setSourceIdentity).toHaveBeenCalledWith({ handle, path: null })
  })

  test('does not publish an identity when writing fails', async () => {
    const handle = {
      kind: 'file',
      name: 'failed.fig',
      createWritable: vi.fn(async () => {
        throw new Error('write failed')
      })
    } as FileSystemFileHandle
    const { actions, setSourceIdentity } = createSaveHarness(handle)

    await expect(actions.saveFigFile()).rejects.toThrow('write failed')
    expect(setSourceIdentity).not.toHaveBeenCalled()
  })

  test('does not write or publish bytes from an export superseded before completion', async () => {
    const createWritable = vi.fn()
    const handle = {
      kind: 'file',
      name: 'stale.fig',
      createWritable
    } as FileSystemFileHandle
    const state = {
      ...createDefaultEditorState('page'),
      documentName: 'Untitled'
    }
    let resolveExport!: (write: { data: Uint8Array; sceneVersion: number }) => void
    const exported = new Promise<{ data: Uint8Array; sceneVersion: number }>((resolve) => {
      resolveExport = resolve
    })
    const setSavedVersion = vi.fn()
    const setSourceIdentity = vi.fn()
    const actions = createSaveActions({
      state,
      buildFigFile: () => exported,
      getFilePath: () => null,
      setFilePath: vi.fn(),
      getFileHandle: () => handle,
      setFileHandle: vi.fn(),
      getDownloadName: () => null,
      setDownloadName: vi.fn(),
      getStorageBinding: () => null,
      setStorageBinding: vi.fn(),
      setSourceIdentity,
      setSavedVersion,
      setLastWriteTime: vi.fn(),
      startWatchingFile: vi.fn()
    })
    const controller = new AbortController()
    const save = actions.saveFigFile(controller.signal)

    controller.abort()
    resolveExport({ data: new Uint8Array([1, 2, 3]), sceneVersion: 0 })

    await expect(save).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(createWritable).not.toHaveBeenCalled()
    expect(setSavedVersion).not.toHaveBeenCalled()
    expect(setSourceIdentity).not.toHaveBeenCalled()
  })

  test('does not mutate or watch a Save As target chosen after cancellation', async () => {
    const createWritable = vi.fn()
    const handle = {
      kind: 'file',
      name: 'stale.fig',
      createWritable
    } as FileSystemFileHandle
    let resolvePicker!: (handle: FileSystemFileHandle) => void
    const picker = new Promise<FileSystemFileHandle>((resolve) => {
      resolvePicker = resolve
    })
    globalThis.window = {
      showSaveFilePicker: vi.fn(() => picker)
    } as unknown as Window & typeof globalThis
    const state = {
      ...createDefaultEditorState('page'),
      documentName: 'Untitled'
    }
    const setFileHandle = vi.fn()
    const setFilePath = vi.fn()
    const setSourceIdentity = vi.fn()
    const startWatchingFile = vi.fn()
    const actions = createSaveActions({
      state,
      buildFigFile: () => ({ data: new Uint8Array([1, 2, 3]), sceneVersion: 0 }),
      getFilePath: () => null,
      setFilePath,
      getFileHandle: () => null,
      setFileHandle,
      getDownloadName: () => null,
      setDownloadName: vi.fn(),
      getStorageBinding: () => null,
      setStorageBinding: vi.fn(),
      setSourceIdentity,
      setSavedVersion: vi.fn(),
      setLastWriteTime: vi.fn(),
      startWatchingFile
    })
    const controller = new AbortController()
    const save = actions.saveFigFileAs(controller.signal)

    controller.abort()
    resolvePicker(handle)

    await expect(save).rejects.toMatchObject({ name: 'AbortError' })
    expect(createWritable).not.toHaveBeenCalled()
    expect(setFileHandle).not.toHaveBeenCalled()
    expect(setFilePath).not.toHaveBeenCalled()
    expect(setSourceIdentity).not.toHaveBeenCalled()
    expect(startWatchingFile).not.toHaveBeenCalled()
    expect(state.documentName).toBe('Untitled')
  })
})
