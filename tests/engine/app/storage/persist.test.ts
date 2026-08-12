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
  test('writes document bytes before enqueueing remote synchronization', async () => {
    const store = createMemoryLocalCanvasStore()
    const observations: string[] = []
    const enqueueCanvas = vi.fn(async (canvasId: string, revision: number) => {
      const bytes = await store.readFig(canvasId)
      observations.push(`${revision}:${bytes?.join(',')}`)
    })

    const result = await persistStorageCanvasLocally(
      {
        providerId: 's3-compatible',
        canvasId: 'canvas-1',
        name: 'Stored design',
        figBytes: new Uint8Array([1, 2, 3])
      },
      { store, enqueueCanvas }
    )

    expect(result.revision).toBe(1)
    expect(observations).toEqual(['1:1,2,3'])
    expect(await store.getMeta('canvas-1')).toMatchObject({
      name: 'Stored design',
      syncStatus: 'pending',
      providerId: 's3-compatible'
    })
  })

  test('stores the embedded preview with the document', async () => {
    const store = createMemoryLocalCanvasStore()
    const enqueueCanvas = vi.fn(() => Promise.resolve())
    const figBytes = new Uint8Array(readFileSync('tests/fixtures/gold-preview.fig'))

    await persistStorageCanvasLocally(
      {
        providerId: 's3-compatible',
        canvasId: 'canvas-preview',
        name: 'Preview design',
        figBytes
      },
      { store, enqueueCanvas }
    )

    const thumbnail = await store.readThumb('canvas-preview')
    expect(thumbnail?.byteLength).toBeGreaterThan(0)
    expect(thumbnail?.subarray(0, 8)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  })

  test('superseded persistence cannot write, enqueue, or emit after staging', async () => {
    const store = createMemoryLocalCanvasStore()
    const enqueueCanvas = vi.fn(() => Promise.resolve())
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
          if (currentGeneration !== 1) {
            throw new DOMException('Save superseded', 'AbortError')
          }
          return commit()
        }
      },
      { store, enqueueCanvas }
    )
    await enteredGuard.promise
    currentGeneration = 2
    releaseGuard.resolve()

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    expect(await store.getMeta('canvas-race')).toBeNull()
    expect(enqueueCanvas).not.toHaveBeenCalled()
    expect(events).toEqual([])
    stop()
  })
})
