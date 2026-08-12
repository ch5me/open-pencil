export type OutboxJobType = 'putCanvas' | 'putThumb' | 'deleteCanvas'

export type OutboxJob = {
  id: string
  canvasId: string
  type: OutboxJobType
  /** Local revision for putCanvas; used to supersede older puts. */
  revision: number
  createdAt: number
  attempts: number
  nextAttemptAt: number
  /** Durable ownership marker assigned after cross-context authority is acquired. */
  claimToken?: string
}

export type OutboxEnqueueInput = Omit<
  OutboxJob,
  'id' | 'createdAt' | 'attempts' | 'nextAttemptAt'
> & {
  id?: string
  attempts?: number
  nextAttemptAt?: number
}

export type OutboxSettlement =
  | { kind: 'success'; syncedAt?: string }
  | {
      kind: 'retry' | 'error'
      message: string
      attempts: number
      nextAttemptAt: number
    }
  | { kind: 'blocked'; nextAttemptAt: number }

export type SyncUIState = 'idle' | 'syncing' | 'offline' | 'error'

/** Pure helper: drop older putCanvas jobs for same canvas when a newer revision is enqueued. */
export function supersedePutCanvasJobs(
  jobs: OutboxJob[],
  canvasId: string,
  revision: number
): OutboxJob[] {
  return jobs.filter((job) => {
    if (job.canvasId !== canvasId || job.type !== 'putCanvas') return true
    return job.revision > revision
  })
}

export function makeJobId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function buildOutboxJob(partial: OutboxEnqueueInput): OutboxJob {
  return {
    id: partial.id ?? makeJobId(),
    canvasId: partial.canvasId,
    type: partial.type,
    revision: partial.revision,
    createdAt: Date.now(),
    attempts: partial.attempts ?? 0,
    nextAttemptAt: partial.nextAttemptAt ?? Date.now(),
    claimToken: partial.claimToken
  }
}

/** Queue with the new job applied; newer work supersedes stale work per type. */
export function queueOutboxJob(queue: OutboxJob[], job: OutboxJob): OutboxJob[] {
  let next = queue
  if (job.type === 'putCanvas') {
    next = supersedePutCanvasJobs(next, job.canvasId, job.revision)
  }
  next = next.filter(
    (existing) =>
      !(
        existing.canvasId === job.canvasId &&
        existing.type === job.type &&
        existing.type !== 'putCanvas'
      )
  )
  return [...next, job]
}
