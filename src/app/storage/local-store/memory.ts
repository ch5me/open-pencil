import { buildIndexMeta, buildWriteMeta, sortAndFilterMetas } from '@/app/storage/local-store/meta'
import type { LocalCanvasStore } from '@/app/storage/local-store/store'
import type { LocalCanvasMeta, LocalCanvasWriteInput } from '@/app/storage/local-store/types'
import { buildOutboxJob, queueOutboxJob, type OutboxJob } from '@/app/storage/sync/types'

/** In-memory store for unit tests and environments without IndexedDB. */
export function createMemoryLocalCanvasStore(): LocalCanvasStore {
  const metas = new Map<string, LocalCanvasMeta>()
  const figs = new Map<string, Uint8Array>()
  const thumbs = new Map<string, Uint8Array>()
  let jobs: OutboxJob[] = []

  return {
    async listMetas(includeTombstones = false) {
      return sortAndFilterMetas([...metas.values()], includeTombstones)
    },

    async getMeta(id: string) {
      return metas.get(id) ?? null
    },

    async readFig(id: string) {
      const bytes = figs.get(id)
      return bytes ? new Uint8Array(bytes) : null
    },

    async readThumb(id: string) {
      const bytes = thumbs.get(id)
      return bytes ? new Uint8Array(bytes) : null
    },

    async writeCanvas(input: LocalCanvasWriteInput) {
      const existing = metas.get(input.id) ?? null
      figs.set(input.id, new Uint8Array(input.figBytes))

      let hasThumb = existing?.hasThumb ?? false
      if (input.thumbBytes != null) {
        if (input.thumbBytes.byteLength > 0) {
          thumbs.set(input.id, new Uint8Array(input.thumbBytes))
          hasThumb = true
        } else {
          thumbs.delete(input.id)
          hasThumb = false
        }
      }

      const meta = buildWriteMeta(input, existing, hasThumb)
      metas.set(input.id, meta)
      return meta
    },

    async publishCanvas(input, options) {
      const existing = metas.get(input.id) ?? null
      if (existing?.tombstoned) return null
      if (
        options?.expectedRevision != null &&
        (existing?.revision ?? 0) !== options.expectedRevision
      ) {
        return null
      }
      const metadata = await this.writeCanvas(input)
      const job = buildOutboxJob({
        canvasId: input.id,
        type: 'putCanvas',
        revision: metadata.revision
      })
      jobs = queueOutboxJob(jobs, job)
      return { metadata, job }
    },

    async upsertIndexMeta(input, options) {
      const existing = metas.get(input.id) ?? null
      if (
        existing?.tombstoned ||
        (options?.expectedRevision != null &&
          (existing?.revision ?? 0) !== options.expectedRevision)
      ) {
        return null
      }
      const meta = buildIndexMeta(input, existing)
      metas.set(input.id, meta)
      return meta
    },

    async seedCanvas(input, options) {
      const existing = metas.get(input.id) ?? null
      if ((existing?.revision ?? 0) !== options.expectedRevision) return null
      return this.writeCanvas(input)
    },

    async writeThumb(id: string, thumbBytes: Uint8Array) {
      const existing = metas.get(id)
      if (!existing) return null
      thumbs.set(id, new Uint8Array(thumbBytes))
      // Thumb freshness is tracked by its own outbox job — never demote the
      // document's syncStatus here (it orphaned rows as 'pending' forever).
      const meta: LocalCanvasMeta = {
        ...existing,
        hasThumb: true
      }
      metas.set(id, meta)
      return meta
    },

    async updateMeta(id: string, patch: Partial<LocalCanvasMeta>, options) {
      const existing = metas.get(id)
      if (
        !existing ||
        (options?.expectedRevision != null && existing.revision !== options.expectedRevision)
      ) {
        return null
      }
      const next = { ...existing, ...patch, id: existing.id }
      metas.set(id, next)
      return next
    },

    async tombstone(id: string) {
      const existing = metas.get(id)
      if (!existing) return null
      const next: LocalCanvasMeta = {
        ...existing,
        tombstoned: true,
        revision: existing.revision + 1,
        syncStatus: 'pending',
        updatedAt: new Date().toISOString()
      }
      metas.set(id, next)
      return next
    },

    async publishCanvasDeletion(id: string) {
      const metadata = await this.tombstone(id)
      if (!metadata) return null
      const job = buildOutboxJob({
        canvasId: id,
        type: 'deleteCanvas',
        revision: metadata.revision
      })
      jobs = queueOutboxJob(
        jobs.filter((candidate) => candidate.canvasId !== id),
        job
      )
      return { metadata, job }
    },

    async clearFig(id: string) {
      const existing = metas.get(id)
      if (!existing) return null
      figs.delete(id)
      const meta: LocalCanvasMeta = { ...existing, hasFig: false, figSize: 0 }
      metas.set(id, meta)
      return meta
    },

    async remove(id: string) {
      metas.delete(id)
      figs.delete(id)
      thumbs.delete(id)
    },

    async purgeTombstone(id, expectedRevision) {
      const existing = metas.get(id)
      if (!existing?.tombstoned || existing.revision !== expectedRevision) return false
      metas.delete(id)
      figs.delete(id)
      thumbs.delete(id)
      return true
    },

    async clearAll() {
      metas.clear()
      figs.clear()
      thumbs.clear()
      jobs = []
    },

    async listOutboxJobs() {
      return [...jobs].sort((a, b) => a.createdAt - b.createdAt)
    },

    async enqueueOutboxJob(partial) {
      const job = buildOutboxJob(partial)
      jobs = queueOutboxJob(jobs, job)
      return job
    },

    async updateOutboxJob(job) {
      jobs = jobs.map((current) =>
        current.id === job.id ? { ...job, claimToken: current.claimToken } : current
      )
    },

    async claimOutboxJob(job, claimToken) {
      const stored = jobs.find((candidate) => candidate.id === job.id)
      if (
        !stored ||
        stored.canvasId !== job.canvasId ||
        stored.type !== job.type ||
        stored.revision !== job.revision
      ) {
        return null
      }
      const claimed = { ...stored, claimToken }
      jobs = jobs.map((candidate) => (candidate.id === job.id ? claimed : candidate))
      return claimed
    },

    async removeOutboxJob(id) {
      jobs = jobs.filter((job) => job.id !== id)
    },

    async settleOutboxJob(job, settlement) {
      const stored = jobs.find((candidate) => candidate.id === job.id)
      if (
        !stored ||
        stored.canvasId !== job.canvasId ||
        stored.type !== job.type ||
        stored.revision !== job.revision ||
        stored.claimToken !== job.claimToken
      ) {
        return false
      }
      const metadata = metas.get(job.canvasId)
      const validMetadata =
        metadata?.revision === job.revision &&
        (job.type === 'deleteCanvas' ? metadata.tombstoned : !metadata.tombstoned)
      if (!validMetadata) {
        jobs = jobs.filter((candidate) => candidate.id !== job.id)
        return false
      }
      if (settlement.kind === 'success') {
        jobs = jobs.filter((candidate) => candidate.id !== job.id)
        if (job.type !== 'putThumb') {
          metas.set(job.canvasId, {
            ...metadata,
            syncStatus: 'synced',
            lastSyncedAt: settlement.syncedAt ?? new Date().toISOString(),
            lastSyncError: null
          })
        }
      } else {
        jobs = jobs.map((candidate) =>
          candidate.id === job.id
            ? {
                ...candidate,
                attempts: settlement.kind === 'blocked' ? candidate.attempts : settlement.attempts,
                nextAttemptAt: settlement.nextAttemptAt
              }
            : candidate
        )
        if (settlement.kind !== 'blocked') {
          let syncStatus = metadata.syncStatus
          if (job.type !== 'putThumb') {
            syncStatus = settlement.kind === 'error' ? 'error' : 'pending'
          }
          metas.set(job.canvasId, {
            ...metadata,
            syncStatus,
            lastSyncError: settlement.message
          })
        }
      }
      return true
    },

    async clearOutbox() {
      jobs = []
    }
  }
}
