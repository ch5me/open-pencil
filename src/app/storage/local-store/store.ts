import { createIdbLocalCanvasStore } from '@/app/storage/local-store/idb'
import { createMemoryLocalCanvasStore } from '@/app/storage/local-store/memory'
import type {
  LocalCanvasIndexInput,
  LocalCanvasMeta,
  LocalCanvasWriteInput
} from '@/app/storage/local-store/types'
import type { OutboxEnqueueInput, OutboxJob, OutboxSettlement } from '@/app/storage/sync/types'

export type UpdateLocalCanvasMetaOptions = {
  /** Apply only if the row still has this revision. */
  expectedRevision?: number
}

export type LocalCanvasStore = {
  listMetas(includeTombstones?: boolean): Promise<LocalCanvasMeta[]>
  getMeta(id: string): Promise<LocalCanvasMeta | null>
  readFig(id: string): Promise<Uint8Array | null>
  readThumb(id: string): Promise<Uint8Array | null>
  writeCanvas(input: LocalCanvasWriteInput): Promise<LocalCanvasMeta>
  /** Atomically publish canvas bytes, metadata, and its durable sync job. */
  publishCanvas(
    input: LocalCanvasWriteInput,
    options?: UpdateLocalCanvasMetaOptions
  ): Promise<{ metadata: LocalCanvasMeta; job: OutboxJob } | null>
  /** Index-only row for remote canvases not yet downloaded (no fig body). */
  upsertIndexMeta(meta: LocalCanvasIndexInput): Promise<LocalCanvasMeta>
  /** Seed only if the local revision has not changed since the remote read began. */
  seedCanvas(
    input: LocalCanvasWriteInput,
    options: UpdateLocalCanvasMetaOptions
  ): Promise<LocalCanvasMeta | null>
  writeThumb(id: string, thumbBytes: Uint8Array): Promise<LocalCanvasMeta | null>
  updateMeta(
    id: string,
    patch: Partial<LocalCanvasMeta>,
    options?: UpdateLocalCanvasMetaOptions
  ): Promise<LocalCanvasMeta | null>
  tombstone(id: string): Promise<LocalCanvasMeta | null>
  /** Drop only the cached fig blob (eviction) — meta and thumb stay. */
  clearFig(id: string): Promise<LocalCanvasMeta | null>
  remove(id: string): Promise<void>
  clearAll(): Promise<void>
  listOutboxJobs(): Promise<OutboxJob[]>
  enqueueOutboxJob(job: OutboxEnqueueInput): Promise<OutboxJob>
  updateOutboxJob(job: OutboxJob): Promise<void>
  removeOutboxJob(id: string): Promise<void>
  /** Atomically settle a job and revision-guarded metadata. */
  settleOutboxJob(job: OutboxJob, settlement: OutboxSettlement): Promise<boolean>
  clearOutbox(): Promise<void>
}

let singleton: LocalCanvasStore | null = null
let usingMemoryFallback = false

export function isLocalCanvasStoreMemoryFallback(): boolean {
  return usingMemoryFallback
}

/** Reset singleton (tests). */
export function resetLocalCanvasStoreForTests(store?: LocalCanvasStore) {
  singleton = store ?? null
  usingMemoryFallback = false
}

/**
 * Process-wide local canvas store.
 * Prefers IndexedDB; falls back to memory (logged) if IDB is unavailable.
 */
export function getLocalCanvasStore(): LocalCanvasStore {
  if (singleton) return singleton
  try {
    if (typeof indexedDB !== 'undefined') {
      singleton = createIdbLocalCanvasStore()
      usingMemoryFallback = false
      return singleton
    }
  } catch (error) {
    console.warn('[Storage] IndexedDB local store unavailable, using memory:', error)
  }
  singleton = createMemoryLocalCanvasStore()
  usingMemoryFallback = true
  return singleton
}
