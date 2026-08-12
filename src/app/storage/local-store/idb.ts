import { openIdb, reqToPromise, txDone } from '@/app/storage/idb-util'
import { buildIndexMeta, buildWriteMeta, sortAndFilterMetas } from '@/app/storage/local-store/meta'
import type { LocalCanvasStore } from '@/app/storage/local-store/store'
import type { LocalCanvasMeta, LocalCanvasWriteInput } from '@/app/storage/local-store/types'
import { buildOutboxJob, queueOutboxJob, type OutboxJob } from '@/app/storage/sync/types'

const DB_NAME = 'open-pencil-cloud-local'
const DB_VERSION = 2

const STORE_META = 'meta'
const STORE_FIG = 'fig'
const STORE_THUMB = 'thumb'
const STORE_JOBS = 'jobs'

function openDb(): Promise<IDBDatabase> {
  return openIdb(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE_META)) {
      db.createObjectStore(STORE_META, { keyPath: 'id' })
    }
    if (!db.objectStoreNames.contains(STORE_FIG)) {
      db.createObjectStore(STORE_FIG)
    }
    if (!db.objectStoreNames.contains(STORE_THUMB)) {
      db.createObjectStore(STORE_THUMB)
    }
    if (!db.objectStoreNames.contains(STORE_JOBS)) {
      db.createObjectStore(STORE_JOBS, { keyPath: 'id' })
    }
  })
}

/** Stored rows may be ArrayBuffer, typed array, or Blob depending on writer/browser. */
async function rowToBytes(row: unknown): Promise<Uint8Array | null> {
  if (row == null) return null
  if (row instanceof ArrayBuffer) return new Uint8Array(row)
  if (row instanceof Uint8Array) return new Uint8Array(row)
  if (row instanceof Blob) return new Uint8Array(await row.arrayBuffer())
  return null
}

function bytesToBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

async function readJobs(store: IDBObjectStore): Promise<OutboxJob[]> {
  return (await reqToPromise(store.getAll())) as OutboxJob[]
}

function writeQueuedJob(store: IDBObjectStore, existing: OutboxJob[], job: OutboxJob) {
  const next = queueOutboxJob(existing, job)
  for (const current of existing) {
    if (!next.some((candidate) => candidate.id === current.id)) store.delete(current.id)
  }
  store.put(job)
}

async function readMetaRow(store: IDBObjectStore, id: string): Promise<LocalCanvasMeta | null> {
  return ((await reqToPromise(store.get(id))) as LocalCanvasMeta | undefined) ?? null
}

/** IndexedDB-backed local canvas store (meta + fig/thumb blobs). */
export function createIdbLocalCanvasStore(): LocalCanvasStore {
  let dbPromise: Promise<IDBDatabase> | null = null

  function db() {
    if (!dbPromise) dbPromise = openDb()
    return dbPromise
  }

  async function readBlob(storeName: string, id: string): Promise<Uint8Array | null> {
    const database = await db()
    const tx = database.transaction(storeName, 'readonly')
    const row = await reqToPromise(tx.objectStore(storeName).get(id))
    await txDone(tx)
    return rowToBytes(row)
  }

  return {
    async listMetas(includeTombstones = false) {
      const database = await db()
      const tx = database.transaction(STORE_META, 'readonly')
      const all = (await reqToPromise(tx.objectStore(STORE_META).getAll())) as LocalCanvasMeta[]
      await txDone(tx)
      return sortAndFilterMetas(all, includeTombstones)
    },

    async getMeta(id: string) {
      const database = await db()
      const tx = database.transaction(STORE_META, 'readonly')
      const row = (await reqToPromise(tx.objectStore(STORE_META).get(id))) as
        | LocalCanvasMeta
        | undefined
      await txDone(tx)
      return row ?? null
    },

    async readFig(id: string) {
      return readBlob(STORE_FIG, id)
    },

    async readThumb(id: string) {
      return readBlob(STORE_THUMB, id)
    },

    async writeCanvas(input: LocalCanvasWriteInput) {
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_FIG, STORE_THUMB], 'readwrite')
      const figStore = tx.objectStore(STORE_FIG)
      const thumbStore = tx.objectStore(STORE_THUMB)
      const metaStore = tx.objectStore(STORE_META)
      const existing = await readMetaRow(metaStore, input.id)

      let hasThumb = existing?.hasThumb ?? false
      figStore.put(bytesToBuffer(input.figBytes), input.id)

      if (input.thumbBytes != null) {
        if (input.thumbBytes.byteLength > 0) {
          thumbStore.put(bytesToBuffer(input.thumbBytes), input.id)
          hasThumb = true
        } else {
          thumbStore.delete(input.id)
          hasThumb = false
        }
      }

      const meta = buildWriteMeta(input, existing, hasThumb)
      metaStore.put(meta)
      await txDone(tx)
      return meta
    },

    async publishCanvas(input, options) {
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_FIG, STORE_THUMB, STORE_JOBS], 'readwrite')
      const metaStore = tx.objectStore(STORE_META)
      const existing = await readMetaRow(metaStore, input.id)
      if (existing?.tombstoned) {
        await txDone(tx)
        return null
      }
      if (
        options?.expectedRevision != null &&
        (existing?.revision ?? 0) !== options.expectedRevision
      ) {
        await txDone(tx)
        return null
      }

      const figStore = tx.objectStore(STORE_FIG)
      const thumbStore = tx.objectStore(STORE_THUMB)
      let hasThumb = existing?.hasThumb ?? false
      figStore.put(bytesToBuffer(input.figBytes), input.id)
      if (input.thumbBytes != null) {
        if (input.thumbBytes.byteLength > 0) {
          thumbStore.put(bytesToBuffer(input.thumbBytes), input.id)
          hasThumb = true
        } else {
          thumbStore.delete(input.id)
          hasThumb = false
        }
      }

      const metadata = buildWriteMeta(input, existing, hasThumb)
      metaStore.put(metadata)
      const job = buildOutboxJob({
        canvasId: input.id,
        type: 'putCanvas',
        revision: metadata.revision
      })
      const jobStore = tx.objectStore(STORE_JOBS)
      writeQueuedJob(jobStore, await readJobs(jobStore), job)
      await txDone(tx)
      return { metadata, job }
    },

    async upsertIndexMeta(input) {
      const database = await db()
      const tx = database.transaction(STORE_META, 'readwrite')
      const store = tx.objectStore(STORE_META)
      const existing = await readMetaRow(store, input.id)
      const meta = buildIndexMeta(input, existing)
      store.put(meta)
      await txDone(tx)
      return meta
    },

    async seedCanvas(input, options) {
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_FIG, STORE_THUMB], 'readwrite')
      const metaStore = tx.objectStore(STORE_META)
      const existing = await readMetaRow(metaStore, input.id)
      if ((existing?.revision ?? 0) !== options.expectedRevision) {
        await txDone(tx)
        return null
      }
      const figStore = tx.objectStore(STORE_FIG)
      const thumbStore = tx.objectStore(STORE_THUMB)
      let hasThumb = existing?.hasThumb ?? false
      figStore.put(bytesToBuffer(input.figBytes), input.id)
      if (input.thumbBytes != null) {
        if (input.thumbBytes.byteLength > 0) {
          thumbStore.put(bytesToBuffer(input.thumbBytes), input.id)
          hasThumb = true
        } else {
          thumbStore.delete(input.id)
          hasThumb = false
        }
      }
      const metadata = buildWriteMeta(input, existing, hasThumb)
      metaStore.put(metadata)
      await txDone(tx)
      return metadata
    },

    async writeThumb(id: string, thumbBytes: Uint8Array) {
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_THUMB], 'readwrite')
      const metaStore = tx.objectStore(STORE_META)
      const existing = await readMetaRow(metaStore, id)
      if (!existing) {
        await txDone(tx)
        return null
      }
      tx.objectStore(STORE_THUMB).put(bytesToBuffer(thumbBytes), id)
      // Thumb freshness is tracked by its own outbox job — never demote the
      // document's syncStatus here (it orphaned rows as 'pending' forever).
      const meta: LocalCanvasMeta = {
        ...existing,
        hasThumb: true
      }
      metaStore.put(meta)
      await txDone(tx)
      return meta
    },

    async updateMeta(id: string, patch: Partial<LocalCanvasMeta>, options) {
      const database = await db()
      const tx = database.transaction(STORE_META, 'readwrite')
      const store = tx.objectStore(STORE_META)
      const existing = await readMetaRow(store, id)
      if (
        !existing ||
        (options?.expectedRevision != null && existing.revision !== options.expectedRevision)
      ) {
        await txDone(tx)
        return null
      }
      const next = { ...existing, ...patch, id: existing.id }
      store.put(next)
      await txDone(tx)
      return next
    },

    async tombstone(id: string) {
      const database = await db()
      const tx = database.transaction(STORE_META, 'readwrite')
      const store = tx.objectStore(STORE_META)
      const existing = await readMetaRow(store, id)
      if (!existing) {
        await txDone(tx)
        return null
      }
      const next: LocalCanvasMeta = {
        ...existing,
        tombstoned: true,
        revision: existing.revision + 1,
        syncStatus: 'pending',
        updatedAt: new Date().toISOString()
      }
      store.put(next)
      await txDone(tx)
      return next
    },

    async publishCanvasDeletion(id: string) {
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_JOBS], 'readwrite')
      const metaStore = tx.objectStore(STORE_META)
      const existing = await readMetaRow(metaStore, id)
      if (!existing) {
        await txDone(tx)
        return null
      }
      const metadata: LocalCanvasMeta = {
        ...existing,
        tombstoned: true,
        revision: existing.revision + 1,
        syncStatus: 'pending',
        updatedAt: new Date().toISOString()
      }
      metaStore.put(metadata)
      const job = buildOutboxJob({
        canvasId: id,
        type: 'deleteCanvas',
        revision: metadata.revision
      })
      const jobStore = tx.objectStore(STORE_JOBS)
      const jobs = (await readJobs(jobStore)).filter((candidate) => candidate.canvasId !== id)
      jobStore.clear()
      for (const candidate of jobs) jobStore.put(candidate)
      jobStore.put(job)
      await txDone(tx)
      return { metadata, job }
    },

    async clearFig(id: string) {
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_FIG], 'readwrite')
      const metaStore = tx.objectStore(STORE_META)
      const existing = await readMetaRow(metaStore, id)
      if (!existing) {
        await txDone(tx)
        return null
      }
      tx.objectStore(STORE_FIG).delete(id)
      const meta: LocalCanvasMeta = { ...existing, hasFig: false, figSize: 0 }
      metaStore.put(meta)
      await txDone(tx)
      return meta
    },

    async remove(id: string) {
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_FIG, STORE_THUMB], 'readwrite')
      tx.objectStore(STORE_META).delete(id)
      tx.objectStore(STORE_FIG).delete(id)
      tx.objectStore(STORE_THUMB).delete(id)
      await txDone(tx)
    },

    async clearAll() {
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_FIG, STORE_THUMB, STORE_JOBS], 'readwrite')
      tx.objectStore(STORE_META).clear()
      tx.objectStore(STORE_FIG).clear()
      tx.objectStore(STORE_THUMB).clear()
      tx.objectStore(STORE_JOBS).clear()
      await txDone(tx)
    },

    async listOutboxJobs() {
      const database = await db()
      const tx = database.transaction(STORE_JOBS, 'readonly')
      const jobs = await readJobs(tx.objectStore(STORE_JOBS))
      await txDone(tx)
      return jobs.sort((a, b) => a.createdAt - b.createdAt)
    },

    async enqueueOutboxJob(partial) {
      const job = buildOutboxJob(partial)
      const database = await db()
      const tx = database.transaction(STORE_JOBS, 'readwrite')
      const store = tx.objectStore(STORE_JOBS)
      writeQueuedJob(store, await readJobs(store), job)
      await txDone(tx)
      return job
    },

    async updateOutboxJob(job) {
      const database = await db()
      const tx = database.transaction(STORE_JOBS, 'readwrite')
      const store = tx.objectStore(STORE_JOBS)
      const stored = (await reqToPromise(store.get(job.id))) as OutboxJob | undefined
      if (stored) store.put({ ...job, claimToken: stored.claimToken })
      await txDone(tx)
    },

    async claimOutboxJob(job, claimToken) {
      const database = await db()
      const tx = database.transaction(STORE_JOBS, 'readwrite')
      const store = tx.objectStore(STORE_JOBS)
      const stored = (await reqToPromise(store.get(job.id))) as OutboxJob | undefined
      if (
        !stored ||
        stored.canvasId !== job.canvasId ||
        stored.type !== job.type ||
        stored.revision !== job.revision
      ) {
        await txDone(tx)
        return null
      }
      const claimed = { ...stored, claimToken }
      store.put(claimed)
      await txDone(tx)
      return claimed
    },

    async removeOutboxJob(id) {
      const database = await db()
      const tx = database.transaction(STORE_JOBS, 'readwrite')
      tx.objectStore(STORE_JOBS).delete(id)
      await txDone(tx)
    },

    async settleOutboxJob(job, settlement) {
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_JOBS], 'readwrite')
      const jobStore = tx.objectStore(STORE_JOBS)
      const stored = (await reqToPromise(jobStore.get(job.id))) as OutboxJob | undefined
      if (
        !stored ||
        stored.canvasId !== job.canvasId ||
        stored.type !== job.type ||
        stored.revision !== job.revision ||
        stored.claimToken !== job.claimToken
      ) {
        await txDone(tx)
        return false
      }

      const metaStore = tx.objectStore(STORE_META)
      const metadata = await readMetaRow(metaStore, job.canvasId)
      const validMetadata =
        metadata?.revision === job.revision &&
        (job.type === 'deleteCanvas' ? metadata.tombstoned : !metadata.tombstoned)
      if (!validMetadata) {
        jobStore.delete(job.id)
        await txDone(tx)
        return false
      }

      if (settlement.kind === 'success') {
        jobStore.delete(job.id)
        if (job.type !== 'putThumb') {
          metaStore.put({
            ...metadata,
            syncStatus: 'synced',
            lastSyncedAt: settlement.syncedAt ?? new Date().toISOString(),
            lastSyncError: null
          })
        }
      } else {
        jobStore.put({
          ...stored,
          attempts: settlement.kind === 'blocked' ? stored.attempts : settlement.attempts,
          nextAttemptAt: settlement.nextAttemptAt
        })
        if (settlement.kind !== 'blocked') {
          let syncStatus = metadata.syncStatus
          if (job.type !== 'putThumb') {
            syncStatus = settlement.kind === 'error' ? 'error' : 'pending'
          }
          metaStore.put({
            ...metadata,
            syncStatus,
            lastSyncError: settlement.message
          })
        }
      }
      await txDone(tx)
      return true
    },

    async clearOutbox() {
      const database = await db()
      const tx = database.transaction(STORE_JOBS, 'readwrite')
      tx.objectStore(STORE_JOBS).clear()
      await txDone(tx)
    }
  }
}
