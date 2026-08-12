import { IS_BROWSER } from '@open-pencil/core/constants'

import {
  activeStorageProviderID,
  createActiveStorageAdapter,
  storageCredentialStatuses,
  storagePreferencesComplete,
  storageProviderRegistry
} from '@/app/integrations/storage'
import { evictLocalFigCache } from '@/app/storage/cache-eviction'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import {
  StorageSyncAuthorityUnsupportedError,
  withCanvasSyncAuthority
} from '@/app/storage/sync/authority-lock'
import { getOutbox } from '@/app/storage/sync/outbox'
import { setUploadProgress } from '@/app/storage/sync/progress'
import { setPendingSyncCount, setSyncUI } from '@/app/storage/sync/status'
import type { OutboxJob } from '@/app/storage/sync/types'
import { emitStorageWorkspaceEvent } from '@/app/storage/workspace/events'

const MAX_ATTEMPTS = 8
const BASE_BACKOFF_MS = 1500
const MAX_BACKOFF_MS = 60_000

class StorageSyncBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageSyncBlockedError'
  }
}

let pumping = false
let wakeTimer: ReturnType<typeof setTimeout> | null = null
let onlineBound = false

function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

function backoffMs(attempts: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1))
  const jitter = Math.floor(exp * 0.2 * ((crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) / 255))
  return exp + jitter
}

export function nextSyncWakeDelay(jobs: OutboxJob[], now = Date.now()): number | null {
  if (jobs.length === 0) return null
  const nextAt = Math.min(...jobs.map((job) => job.nextAttemptAt))
  return nextAt === Number.MAX_SAFE_INTEGER ? null : Math.max(250, nextAt - now)
}

function isPermanentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('403') ||
    msg.includes('401') ||
    msg.includes('access denied') ||
    msg.includes('invalid access key') ||
    msg.includes('not configured')
  )
}

async function runJob(job: OutboxJob): Promise<void> {
  const store = getLocalCanvasStore()
  const meta = await store.getMeta(job.canvasId)
  const providerID = meta?.providerId ?? activeStorageProviderID.value
  if (!storagePreferencesComplete(providerID)) {
    throw new StorageSyncBlockedError('Storage is not configured')
  }
  const provider = storageProviderRegistry.get(providerID)
  const statuses = await storageCredentialStatuses(providerID)
  const missingCredential = provider.credentialFields.some(
    (field) => field.required && statuses[field.id] !== 'configured'
  )
  if (missingCredential) {
    throw new StorageSyncBlockedError('Storage credentials are unavailable')
  }
  const adapter = createActiveStorageAdapter(providerID)

  if (job.type === 'deleteCanvas') {
    await adapter.deleteDocument(job.canvasId)
    // Keep the tombstoned row: reconcile purges it once the remote listing
    // confirms the object is gone. Removing it here opened a race where a
    // concurrent reconcile re-seeded the canvas from a stale remote listing.
    return
  }

  if (!meta || meta.tombstoned) {
    // Nothing to put
    return
  }

  if (job.type === 'putCanvas') {
    // Superseded by a newer local revision already on disk
    if (meta.revision > job.revision) return
    if (!meta.hasFig) return
    const fig = await store.readFig(job.canvasId)
    if (!fig || fig.byteLength === 0) throw new Error('Local document missing for sync')
    setUploadProgress(job.canvasId, 0)
    try {
      await adapter.putDocument(
        job.canvasId,
        fig,
        {
          name: meta.name,
          updatedAt: meta.updatedAt
        },
        ({ transferredBytes, totalBytes }) => {
          if (totalBytes) setUploadProgress(job.canvasId, transferredBytes / totalBytes)
        }
      )
    } finally {
      setUploadProgress(job.canvasId, null)
    }
    return
  }

  // Remaining job type: putThumb
  if (!adapter.putThumbnail) return
  const thumb = await store.readThumb(job.canvasId)
  if (!thumb) return
  await adapter.putThumbnail(job.canvasId, thumb)
}

export async function settleCompletedStorageJob(job: OutboxJob): Promise<boolean> {
  const settled = await getLocalCanvasStore().settleOutboxJob(job, {
    kind: 'success',
    syncedAt: new Date().toISOString()
  })
  if (!settled || job.type !== 'putCanvas') return settled
  await evictLocalFigCache(new Set([job.canvasId]))
  const metadata = await getLocalCanvasStore().getMeta(job.canvasId)
  if (metadata) {
    emitStorageWorkspaceEvent({
      providerId: metadata.providerId,
      documentId: job.canvasId,
      kind: 'synced'
    })
  }
  return true
}

export async function settleFailedStorageJob(
  job: OutboxJob,
  message: string,
  attempts: number,
  permanent: boolean
): Promise<boolean> {
  return getLocalCanvasStore().settleOutboxJob(job, {
    kind: permanent ? 'error' : 'retry',
    message,
    attempts,
    nextAttemptAt: permanent ? Number.MAX_SAFE_INTEGER : Date.now() + backoffMs(attempts)
  })
}

async function pumpOnce(): Promise<void> {
  const outbox = getOutbox()
  const jobs = await outbox.list()
  setPendingSyncCount(jobs.length)

  if (jobs.length === 0) {
    if (isOnline()) setSyncUI('idle')
    return
  }

  if (!isOnline()) {
    setSyncUI('offline')
    scheduleWake(5000)
    return
  }

  setSyncUI('syncing')
  const now = Date.now()
  // Single-flight globally for simplicity (large figs)
  const job = jobs.find((j) => j.nextAttemptAt <= now)
  if (!job) {
    const delay = nextSyncWakeDelay(jobs, now)
    if (delay != null) scheduleWake(delay)
    return
  }

  await withCanvasSyncAuthority(job.canvasId, async () => {
    const claimToken = crypto.randomUUID()
    const claimedJob = await getLocalCanvasStore().claimOutboxJob(job, claimToken)
    if (!claimedJob) return
    try {
      await runJob(claimedJob)
      await settleCompletedStorageJob(claimedJob)
      const remaining = await outbox.list()
      setPendingSyncCount(remaining.length)
      if (remaining.length === 0) setSyncUI('idle')
      else scheduleWake(50)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof StorageSyncBlockedError) {
        await getLocalCanvasStore().settleOutboxJob(claimedJob, {
          kind: 'blocked',
          nextAttemptAt: Number.MAX_SAFE_INTEGER
        })
        setSyncUI('error', message)
        return
      }

      const attempts = claimedJob.attempts + 1
      const permanent = isPermanentError(error) || attempts >= MAX_ATTEMPTS
      console.warn('[Storage sync] job failed:', claimedJob.type, claimedJob.canvasId, message)

      if (permanent) {
        const settled = await settleFailedStorageJob(claimedJob, message, attempts, true)
        if (settled && claimedJob.type !== 'putThumb') {
          setSyncUI('error', message.slice(0, 120))
        }
        if (settled && claimedJob.type === 'putThumb') {
          await outbox.remove(claimedJob.id)
          const remaining = await outbox.list()
          setPendingSyncCount(remaining.length)
          if (remaining.length > 0) scheduleWake(1000)
          else setSyncUI('idle')
        }
        return
      }

      await settleFailedStorageJob(claimedJob, message, attempts, false)
      // Wake for the next ready job across the whole queue — not this job's
      // full backoff, which starved other jobs that were ready sooner.
      const all = await outbox.list()
      const nextAt = Math.min(...all.map((j) => j.nextAttemptAt))
      scheduleWake(Math.max(250, nextAt - Date.now()))
    }
  })
}

function scheduleWake(ms: number) {
  if (wakeTimer != null) clearTimeout(wakeTimer)
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    void kickSyncEngine()
  }, ms)
}

function ensureOnlineListeners() {
  if (onlineBound || !IS_BROWSER) return
  onlineBound = true
  window.addEventListener('online', () => {
    setSyncUI('syncing')
    void kickSyncEngine()
  })
  window.addEventListener('offline', () => {
    setSyncUI('offline')
  })
}

/** Start or continue draining the outbox. Safe to call often. */
export async function kickSyncEngine(): Promise<void> {
  ensureOnlineListeners()
  if (pumping) return
  pumping = true
  let pumpFailed = false
  try {
    // Drain a few jobs per kick to avoid long tight loops blocking the tab.
    for (let i = 0; i < 3; i++) {
      const before = (await getOutbox().list()).length
      await pumpOnce()
      const after = (await getOutbox().list()).length
      if (after === 0 || after >= before) break
    }
  } catch (error) {
    // Never let an escaped rejection strand the queue — retry shortly.
    pumpFailed = true
    console.warn('[Storage sync] pump failed:', error)
    if (error instanceof StorageSyncAuthorityUnsupportedError) {
      setSyncUI('error', error.message)
    } else {
      scheduleWake(5000)
    }
  } finally {
    pumping = false
  }
  // A job enqueued mid-pump can slip past the loop's exit check while its
  // kick was swallowed by the pumping guard — re-wake if work is already due.
  // (Skip offline — pumpOnce owns those wakes — and errors, which keep their
  // 5s backoff; re-waking would clobber it into a tight retry loop.)
  if (pumpFailed || !isOnline()) return
  const jobs = await getOutbox().list()
  if (jobs.some((job) => job.nextAttemptAt <= Date.now())) scheduleWake(250)
}

export async function enqueuePutCanvas(canvasId: string, revision: number): Promise<void> {
  await getOutbox().enqueue({ canvasId, type: 'putCanvas', revision })
  void kickSyncEngine()
}

export async function enqueuePutThumb(canvasId: string, revision: number): Promise<void> {
  await getOutbox().enqueue({ canvasId, type: 'putThumb', revision })
  void kickSyncEngine()
}

export async function enqueueDeleteCanvas(canvasId: string): Promise<void> {
  await getLocalCanvasStore().publishCanvasDeletion(canvasId)
  void kickSyncEngine()
}

/** Retry durable work immediately after storage settings or credentials change. */
export async function resumeStorageSync(): Promise<void> {
  const outbox = getOutbox()
  const jobs = await outbox.list()
  const now = Date.now()
  await Promise.all(jobs.map((job) => outbox.update({ ...job, nextAttemptAt: now })))
  if (jobs.length > 0) setSyncUI('syncing')
  void kickSyncEngine()
}

/** After credentials cleared — drop local mirror + outbox (optional safety). */
export async function clearStorageLocalMirror(): Promise<void> {
  await getLocalCanvasStore().clearAll()
  await getOutbox().clear()
  setPendingSyncCount(0)
  setSyncUI('idle')
}
