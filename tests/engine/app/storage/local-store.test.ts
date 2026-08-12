import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'

import {
  createMemoryLocalCanvasStore,
  resetLocalCanvasStoreForTests
} from '@/app/storage/local-store'
import { createIdbLocalCanvasStore } from '@/app/storage/local-store/idb'

import { expectDefined } from '#tests/helpers/assert'

describe('local canvas store (memory)', () => {
  test('writes and reads fig bytes outside localStorage', async () => {
    const store = createMemoryLocalCanvasStore()
    resetLocalCanvasStoreForTests(store)
    const fig = new Uint8Array([1, 2, 3, 4, 5])
    const meta = await store.writeCanvas({
      id: 'c1',
      providerId: 's3-compatible',
      name: 'Demo',
      figBytes: fig
    })
    expect(meta.revision).toBe(1)
    expect(meta.syncStatus).toBe('pending')
    expect(meta.hasFig).toBe(true)

    const read = expectDefined(await store.readFig('c1'))
    expect([...read]).toEqual([1, 2, 3, 4, 5])

    const list = await store.listMetas()
    expect(list.map((m) => m.id)).toEqual(['c1'])
  })

  test('increments revision and hides tombstones from list', async () => {
    const store = createMemoryLocalCanvasStore()
    await store.writeCanvas({
      id: 'c1',
      providerId: 's3-compatible',
      name: 'A',
      figBytes: new Uint8Array([9])
    })
    const second = await store.writeCanvas({
      id: 'c1',
      providerId: 's3-compatible',
      name: 'A2',
      figBytes: new Uint8Array([9, 9])
    })
    expect(second.revision).toBe(2)
    await store.tombstone('c1')
    expect((await store.listMetas(false)).length).toBe(0)
    expect((await store.listMetas(true)).length).toBe(1)
  })

  test('rejects stale revision-conditional metadata updates', async () => {
    const store = createMemoryLocalCanvasStore()
    await store.writeCanvas({
      id: 'conditional',
      providerId: 's3-compatible',
      name: 'Draft',
      figBytes: new Uint8Array([1])
    })

    expect(
      await store.updateMeta('conditional', { syncStatus: 'synced' }, { expectedRevision: 0 })
    ).toBeNull()
    expect((await store.getMeta('conditional'))?.syncStatus).toBe('pending')
  })

  test('upsertIndexMeta does not require fig body', async () => {
    const store = createMemoryLocalCanvasStore()
    const meta = await store.upsertIndexMeta({
      id: 'remote-1',
      providerId: 's3-compatible',
      name: 'From bucket',
      updatedAt: '2026-01-01T00:00:00.000Z',
      syncStatus: 'synced',
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      lastSyncError: null,
      hasFig: false
    })
    expect(meta.hasFig).toBe(false)
    expect(await store.readFig('remote-1')).toBeNull()
  })
})

describe('local canvas store (IndexedDB)', () => {
  test('serializes concurrent writes into distinct revisions', async () => {
    const store = createIdbLocalCanvasStore()
    const id = `concurrent-${crypto.randomUUID()}`
    const writes = await Promise.all([
      store.writeCanvas({
        id,
        providerId: 's3-compatible',
        name: 'First',
        figBytes: new Uint8Array([1])
      }),
      store.writeCanvas({
        id,
        providerId: 's3-compatible',
        name: 'Second',
        figBytes: new Uint8Array([2])
      })
    ])

    expect(writes.map((meta) => meta.revision).sort()).toEqual([1, 2])
    expect((await store.getMeta(id))?.revision).toBe(2)
  })

  test('publishes bytes, metadata, and outbox job in one durable transaction', async () => {
    const store = createIdbLocalCanvasStore()
    const id = `published-${crypto.randomUUID()}`
    const published = await store.publishCanvas({
      id,
      providerId: 's3-compatible',
      name: 'Published',
      figBytes: new Uint8Array([4, 5, 6])
    })

    expect(published?.metadata.revision).toBe(1)
    expect(await store.readFig(id)).toEqual(new Uint8Array([4, 5, 6]))
    expect((await store.listOutboxJobs()).map((job) => job.revision)).toEqual([1])
  })

  test('cross-context CAS admits one writer and keeps its matching job', async () => {
    const first = createIdbLocalCanvasStore()
    const second = createIdbLocalCanvasStore()
    const id = `cas-${crypto.randomUUID()}`
    const results = await Promise.all([
      first.publishCanvas(
        {
          id,
          providerId: 's3-compatible',
          name: 'First',
          figBytes: new Uint8Array([1])
        },
        { expectedRevision: 0 }
      ),
      second.publishCanvas(
        {
          id,
          providerId: 's3-compatible',
          name: 'Second',
          figBytes: new Uint8Array([2])
        },
        { expectedRevision: 0 }
      )
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await first.getMeta(id))?.revision).toBe(1)
    expect((await first.listOutboxJobs()).filter((job) => job.canvasId === id)).toHaveLength(1)
  })

  test('seed CAS cannot overwrite a concurrent local save', async () => {
    const seedContext = createIdbLocalCanvasStore()
    const saveContext = createIdbLocalCanvasStore()
    const id = `seed-${crypto.randomUUID()}`
    await saveContext.publishCanvas(
      {
        id,
        providerId: 's3-compatible',
        name: 'Local save',
        figBytes: new Uint8Array([9])
      },
      { expectedRevision: 0 }
    )

    expect(
      await seedContext.seedCanvas(
        {
          id,
          providerId: 's3-compatible',
          name: 'Remote seed',
          figBytes: new Uint8Array([1]),
          revision: 1,
          syncStatus: 'synced'
        },
        { expectedRevision: 0 }
      )
    ).toBeNull()
    expect(await seedContext.readFig(id)).toEqual(new Uint8Array([9]))
  })

  test('index CAS cannot overwrite a cross-context save or revive a tombstone', async () => {
    const refreshContext = createIdbLocalCanvasStore()
    const mutationContext = createIdbLocalCanvasStore()
    const savedID = `index-save-${crypto.randomUUID()}`
    await mutationContext.publishCanvas(
      {
        id: savedID,
        providerId: 's3-compatible',
        name: 'Local save',
        figBytes: new Uint8Array([9])
      },
      { expectedRevision: 0 }
    )

    expect(
      await refreshContext.upsertIndexMeta(
        {
          id: savedID,
          providerId: 's3-compatible',
          name: 'Stale remote',
          updatedAt: '2026-01-01T00:00:00.000Z',
          syncStatus: 'synced',
          lastSyncedAt: '2026-01-01T00:00:00.000Z',
          lastSyncError: null
        },
        { expectedRevision: 0 }
      )
    ).toBeNull()
    expect(await refreshContext.getMeta(savedID)).toMatchObject({
      name: 'Local save',
      revision: 1,
      syncStatus: 'pending',
      tombstoned: false
    })

    const deletedID = `index-delete-${crypto.randomUUID()}`
    await mutationContext.writeCanvas({
      id: deletedID,
      providerId: 's3-compatible',
      name: 'Deleted',
      figBytes: new Uint8Array([1])
    })
    const tombstone = expectDefined(await mutationContext.publishCanvasDeletion(deletedID)).metadata
    expect(
      await refreshContext.upsertIndexMeta(
        {
          id: deletedID,
          providerId: 's3-compatible',
          name: 'Stale remote',
          updatedAt: '2026-01-01T00:00:00.000Z',
          syncStatus: 'synced',
          lastSyncedAt: '2026-01-01T00:00:00.000Z',
          lastSyncError: null
        },
        { expectedRevision: tombstone.revision }
      )
    ).toBeNull()
    expect(await refreshContext.getMeta(deletedID)).toMatchObject({
      revision: tombstone.revision,
      syncStatus: 'pending',
      tombstoned: true
    })
  })

  test('tombstone purge is revision guarded across contexts', async () => {
    const refreshContext = createIdbLocalCanvasStore()
    const deleteContext = createIdbLocalCanvasStore()
    const id = `purge-${crypto.randomUUID()}`
    await deleteContext.writeCanvas({
      id,
      providerId: 's3-compatible',
      name: 'Deleted',
      figBytes: new Uint8Array([1])
    })
    const first = expectDefined(await deleteContext.publishCanvasDeletion(id)).metadata
    const newer = expectDefined(await deleteContext.publishCanvasDeletion(id)).metadata

    expect(await refreshContext.purgeTombstone(id, first.revision)).toBe(false)
    expect(await refreshContext.getMeta(id)).toMatchObject({
      revision: newer.revision,
      tombstoned: true
    })
    expect(await refreshContext.purgeTombstone(id, newer.revision)).toBe(true)
    expect(await refreshContext.getMeta(id)).toBeNull()
  })

  test('stale success settlement cannot remove or sync a newer revision', async () => {
    const store = createIdbLocalCanvasStore()
    const id = `settle-${crypto.randomUUID()}`
    const first = await store.publishCanvas({
      id,
      providerId: 's3-compatible',
      name: 'N',
      figBytes: new Uint8Array([1])
    })
    await store.publishCanvas(
      {
        id,
        providerId: 's3-compatible',
        name: 'N+1',
        figBytes: new Uint8Array([2])
      },
      { expectedRevision: 1 }
    )

    const firstJob = expectDefined(first).job
    expect(
      await store.settleOutboxJob(firstJob, {
        kind: 'success',
        syncedAt: '2026-08-12T00:00:00.000Z'
      })
    ).toBe(false)
    expect(await store.getMeta(id)).toMatchObject({ revision: 2, syncStatus: 'pending' })
    expect((await store.listOutboxJobs()).map((job) => job.revision)).toContain(2)
  })

  test('failed job N cannot poison waiting save N+1', async () => {
    const store = createIdbLocalCanvasStore()
    const id = `failed-${crypto.randomUUID()}`
    const first = await store.publishCanvas({
      id,
      providerId: 's3-compatible',
      name: 'N',
      figBytes: new Uint8Array([1])
    })
    await store.publishCanvas(
      {
        id,
        providerId: 's3-compatible',
        name: 'N+1',
        figBytes: new Uint8Array([2])
      },
      { expectedRevision: 1 }
    )

    const firstJob = expectDefined(first).job
    expect(
      await store.settleOutboxJob(firstJob, {
        kind: 'error',
        message: 'upload failed',
        attempts: 8,
        nextAttemptAt: Number.MAX_SAFE_INTEGER
      })
    ).toBe(false)
    expect(await store.getMeta(id)).toMatchObject({
      name: 'N+1',
      revision: 2,
      syncStatus: 'pending',
      lastSyncError: null
    })
  })

  test('re-reads and claims the exact durable job before settlement', async () => {
    const firstContext = createIdbLocalCanvasStore()
    const secondContext = createIdbLocalCanvasStore()
    const id = `claim-${crypto.randomUUID()}`
    const published = expectDefined(
      await firstContext.publishCanvas({
        id,
        providerId: 's3-compatible',
        name: 'Claimed',
        figBytes: new Uint8Array([3])
      })
    )

    const claimed = expectDefined(await secondContext.claimOutboxJob(published.job, 'context-two'))
    expect(claimed.claimToken).toBe('context-two')
    expect(
      await firstContext.settleOutboxJob(published.job, {
        kind: 'success'
      })
    ).toBe(false)
    expect(
      await firstContext.settleOutboxJob(claimed, {
        kind: 'success'
      })
    ).toBe(true)
  })

  test('stale outbox updates preserve claims and cannot resurrect settled jobs', async () => {
    const firstContext = createIdbLocalCanvasStore()
    const secondContext = createIdbLocalCanvasStore()
    const id = `stale-update-${crypto.randomUUID()}`
    const published = expectDefined(
      await firstContext.publishCanvas({
        id,
        providerId: 's3-compatible',
        name: 'Claimed',
        figBytes: new Uint8Array([3])
      })
    )
    const claimed = expectDefined(await secondContext.claimOutboxJob(published.job, 'context-two'))

    await firstContext.updateOutboxJob({ ...published.job, nextAttemptAt: 0 })
    expect(
      (await secondContext.listOutboxJobs()).find((job) => job.id === published.job.id)
    ).toEqual({ ...published.job, claimToken: 'context-two', nextAttemptAt: 0 })
    expect(await secondContext.settleOutboxJob(claimed, { kind: 'success' })).toBe(true)

    await firstContext.updateOutboxJob({ ...published.job, nextAttemptAt: 0 })
    expect(
      (await secondContext.listOutboxJobs()).find((job) => job.id === published.job.id)
    ).toBeUndefined()
  })

  test('delete settlement follows tombstone revision instead of revision zero', async () => {
    const firstContext = createIdbLocalCanvasStore()
    const secondContext = createIdbLocalCanvasStore()
    const id = `delete-${crypto.randomUUID()}`
    await firstContext.publishCanvas({
      id,
      providerId: 's3-compatible',
      name: 'Delete me',
      figBytes: new Uint8Array([7])
    })

    const deletion = expectDefined(await secondContext.publishCanvasDeletion(id))
    expect(deletion.metadata).toMatchObject({ tombstoned: true, revision: 2 })
    expect(deletion.job).toMatchObject({ type: 'deleteCanvas', revision: 2 })
    const claimed = expectDefined(await firstContext.claimOutboxJob(deletion.job, 'delete-context'))
    expect(await firstContext.settleOutboxJob(claimed, { kind: 'success' })).toBe(true)
    expect(await secondContext.getMeta(id)).toMatchObject({
      tombstoned: true,
      revision: 2,
      syncStatus: 'synced'
    })
  })

  test('stale put cannot finish after a newer tombstone revision', async () => {
    const firstContext = createIdbLocalCanvasStore()
    const secondContext = createIdbLocalCanvasStore()
    const id = `delete-race-${crypto.randomUUID()}`
    const published = expectDefined(
      await firstContext.publishCanvas({
        id,
        providerId: 's3-compatible',
        name: 'N',
        figBytes: new Uint8Array([1])
      })
    )
    const claimedPut = expectDefined(
      await firstContext.claimOutboxJob(published.job, 'put-context')
    )
    await secondContext.publishCanvasDeletion(id)

    expect(await firstContext.settleOutboxJob(claimedPut, { kind: 'success' })).toBe(false)
    expect(await firstContext.getMeta(id)).toMatchObject({ tombstoned: true, revision: 2 })
  })
})
