import { describe, expect, test, vi } from 'bun:test'
import { readFileSync } from 'node:fs'

import { createMemoryLocalCanvasStore } from '@/app/storage/local-store'
import { persistStorageCanvasLocally } from '@/app/storage/sync/persist'
import { onStorageWorkspaceEvent } from '@/app/storage/workspace/events'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('local-first storage persistence', () => {
  test('atomically publishes document bytes, metadata, and sync job', async () => {
    const store = createMemoryLocalCanvasStore()
    const observations: string[] = []
    const kickSync = vi.fn(async () => {
      const job = (await store.listOutboxJobs())[0]
      const bytes = job ? await store.readFig(job.canvasId) : null
      observations.push(`${job?.revision}:${bytes?.join(',')}`)
    })

    const result = await persistStorageCanvasLocally(
      {
        providerId: 's3-compatible',
        canvasId: 'canvas-1',
        name: 'Stored design',
        figBytes: new Uint8Array([1, 2, 3])
      },
      { store, kickSync }
    )

    expect(result.revision).toBe(1)
    expect(observations).toEqual(['1:1,2,3'])
    expect(await store.getMeta('canvas-1')).toMatchObject({
      name: 'Stored design',
      syncStatus: 'pending',
      providerId: 's3-compatible'
    })
    expect((await store.listOutboxJobs()).map((job) => job.revision)).toEqual([1])
  })

  test('stores the embedded preview with the document', async () => {
    const store = createMemoryLocalCanvasStore()
    const figBytes = new Uint8Array(readFileSync('tests/fixtures/gold-preview.fig'))

    await persistStorageCanvasLocally(
      {
        providerId: 's3-compatible',
        canvasId: 'canvas-preview',
        name: 'Preview design',
        figBytes
      },
      { store, kickSync: vi.fn() }
    )

    const thumbnail = await store.readThumb('canvas-preview')
    expect(thumbnail?.byteLength).toBeGreaterThan(0)
    expect(thumbnail?.subarray(0, 8)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  })

  test('superseded persistence cannot publish or emit after staging', async () => {
    const store = createMemoryLocalCanvasStore()
    const kickSync = vi.fn()
    const releaseGuard = deferred()
    const enteredGuard = deferred()
    const events: string[] = []
    const stop = onStorageWorkspaceEvent((event) => events.push(event.kind))
    let currentGeneration = 1

    const stale = persistStorageCanvasLocally(
      {
        providerId: 's3-compatible',
        canvasId: 'canvas-race',
        name: 'Stale design',
        figBytes: new Uint8Array(readFileSync('tests/fixtures/gold-preview.fig')),
        commitIfCurrent: async (commit) => {
          enteredGuard.resolve()
          await releaseGuard.promise
          if (currentGeneration !== 1) throw new DOMException('Save superseded', 'AbortError')
          return commit(
            () => undefined,
            () => undefined
          )
        }
      },
      { store, kickSync }
    )
    await enteredGuard.promise
    currentGeneration = 2
    releaseGuard.resolve()

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    expect(await store.getMeta('canvas-race')).toBeNull()
    expect(await store.listOutboxJobs()).toEqual([])
    expect(kickSync).not.toHaveBeenCalled()
    expect(events).toEqual([])
    stop()
  })

  test('failed later save preserves prior durable revision and job', async () => {
    const store = createMemoryLocalCanvasStore()
    await store.publishCanvas({
      id: 'canvas-race',
      providerId: 's3-compatible',
      name: 'Original design',
      figBytes: new Uint8Array([9, 8, 7]),
      syncStatus: 'pending'
    })
    const publishCanvas = store.publishCanvas.bind(store)
    store.publishCanvas = async (input, options) => {
      if (input.name === 'Replacement design') throw new Error('replacement failed')
      return publishCanvas(input, options)
    }

    await expect(
      persistStorageCanvasLocally(
        {
          providerId: 's3-compatible',
          canvasId: 'canvas-race',
          name: 'Replacement design',
          figBytes: new Uint8Array(readFileSync('tests/fixtures/gold-preview.fig'))
        },
        { store, kickSync: vi.fn() }
      )
    ).rejects.toThrow('replacement failed')

    expect(await store.getMeta('canvas-race')).toMatchObject({
      name: 'Original design',
      revision: 1,
      syncStatus: 'pending'
    })
    expect(await store.readFig('canvas-race')).toEqual(new Uint8Array([9, 8, 7]))
    expect((await store.listOutboxJobs()).map((job) => job.revision)).toEqual([1])
  })
})
