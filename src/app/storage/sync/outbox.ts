import { openIdb, reqToPromise, txDone } from '@/app/storage/idb-util'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import {
  buildOutboxJob,
  queueOutboxJob,
  type OutboxEnqueueInput,
  type OutboxJob
} from '@/app/storage/sync/types'

const LEGACY_DB_NAME = 'open-pencil-cloud-outbox'
const LEGACY_DB_VERSION = 1
const LEGACY_STORE = 'jobs'

export type Outbox = {
  list(): Promise<OutboxJob[]>
  enqueue(job: OutboxEnqueueInput): Promise<OutboxJob>
  update(job: OutboxJob): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

export function createMemoryOutbox(): Outbox {
  let jobs: OutboxJob[] = []

  return {
    async list() {
      return [...jobs].sort((a, b) => a.createdAt - b.createdAt)
    },
    async enqueue(partial) {
      const job = buildOutboxJob(partial)
      jobs = queueOutboxJob(jobs, job)
      return job
    },
    async update(job) {
      jobs = jobs.map((j) => (j.id === job.id ? job : j))
    },
    async remove(id) {
      jobs = jobs.filter((j) => j.id !== id)
    },
    async clear() {
      jobs = []
    }
  }
}

export function createIdbOutbox(): Outbox {
  let migration: Promise<void> | null = null
  function ensureMigrated() {
    if (!migration) {
      migration = (async () => {
        const legacy = await openIdb(LEGACY_DB_NAME, LEGACY_DB_VERSION, (db) => {
          if (!db.objectStoreNames.contains(LEGACY_STORE)) {
            db.createObjectStore(LEGACY_STORE, { keyPath: 'id' })
          }
        })
        const readTx = legacy.transaction(LEGACY_STORE, 'readonly')
        const jobs = (await reqToPromise(readTx.objectStore(LEGACY_STORE).getAll())) as OutboxJob[]
        await txDone(readTx)
        for (const job of jobs) await getLocalCanvasStore().enqueueOutboxJob(job)
        if (jobs.length > 0) {
          const clearTx = legacy.transaction(LEGACY_STORE, 'readwrite')
          clearTx.objectStore(LEGACY_STORE).clear()
          await txDone(clearTx)
        }
        legacy.close()
      })()
    }
    return migration
  }

  return {
    async list() {
      await ensureMigrated()
      return getLocalCanvasStore().listOutboxJobs()
    },

    async enqueue(partial) {
      await ensureMigrated()
      return getLocalCanvasStore().enqueueOutboxJob(partial)
    },

    async update(job) {
      await ensureMigrated()
      await getLocalCanvasStore().updateOutboxJob(job)
    },

    async remove(id) {
      await ensureMigrated()
      await getLocalCanvasStore().removeOutboxJob(id)
    },

    async clear() {
      await ensureMigrated()
      await getLocalCanvasStore().clearOutbox()
    }
  }
}

let outboxSingleton: Outbox | null = null

export function resetOutboxForTests(outbox?: Outbox) {
  outboxSingleton = outbox ?? null
}

export function getOutbox(): Outbox {
  if (outboxSingleton) return outboxSingleton
  try {
    if (typeof indexedDB !== 'undefined') {
      outboxSingleton = createIdbOutbox()
      return outboxSingleton
    }
  } catch (error) {
    console.warn('[Storage] Outbox IDB unavailable, using memory:', error)
  }
  outboxSingleton = createMemoryOutbox()
  return outboxSingleton
}
