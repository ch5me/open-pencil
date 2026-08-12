export interface AdaptiveWorkerPolicy {
  readonly budgetMs: number
  readonly thresholdMisses: number
  readonly workerAvailable: boolean
  readonly useWorker: boolean
}

export interface AdaptiveWorkerGate {
  record(durationMs: number): void
  policy(workerAvailable: boolean): AdaptiveWorkerPolicy
}

/** Keep worker offload dormant until measured main-thread work misses its budget. */
export function createAdaptiveWorkerPolicy(
  observedMs: readonly number[],
  options: { budgetMs?: number; workerAvailable?: boolean } = {}
): AdaptiveWorkerPolicy {
  const budgetMs = options.budgetMs ?? 50
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new RangeError('worker budget must be positive')
  }
  const thresholdMisses = observedMs.filter((duration) => {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new RangeError('worker observations must be finite and non-negative')
    }
    return duration > budgetMs
  }).length
  const workerAvailable = options.workerAvailable ?? false
  return {
    budgetMs,
    thresholdMisses,
    workerAvailable,
    useWorker: workerAvailable && thresholdMisses > 0
  }
}

export function createAdaptiveWorkerGate(options: { budgetMs?: number } = {}): AdaptiveWorkerGate {
  const budgetMs = options.budgetMs ?? 50
  const observations: number[] = []
  return {
    record(durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError('worker observations must be finite and non-negative')
      }
      observations.push(durationMs)
    },
    policy(workerAvailable) {
      return createAdaptiveWorkerPolicy(observations, { budgetMs, workerAvailable })
    }
  }
}
