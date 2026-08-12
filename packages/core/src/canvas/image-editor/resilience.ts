import { MEMORY_PROFILE_LIMITS, type MemoryProfile } from '#core/io/transactional/protocol'

import {
  createImageTilePlan,
  ImageTextureMemoryBudgetError,
  ImageTilePlanLimitError,
  type ImageTilePlan
} from './tiling'
import {
  ImageRenderContextLostError,
  UnsupportedImageBackendError,
  createRendererResilienceContract,
  type ImageRenderAdapter,
  type ImageRenderFrame,
  type RendererResilienceContract
} from './types'

export class RetryPolicyError extends Error {
  readonly code = 'E_IMAGE_RETRY_POLICY'
  readonly name = 'RetryPolicyError'
}

export class RetryExhaustedError extends Error {
  readonly code = 'E_IMAGE_RETRY_EXHAUSTED'
  readonly name = 'RetryExhaustedError'
  readonly attempts: number
  readonly cause: unknown

  constructor(message: string, attempts: number, cause: unknown) {
    super(message)
    this.attempts = attempts
    this.cause = cause
  }
}

export interface RetryPolicy {
  /** Total attempts including the first, never a count of extra tries. */
  readonly maxAttempts: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
}

export const IMAGE_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 25,
  maxDelayMs: 400
}

export interface RetryAttemptFailure {
  readonly attempt: number
  readonly error: unknown
  readonly delayMs: number
}

export interface RetryReport<T> {
  readonly value: T
  readonly attempts: number
  readonly failures: readonly RetryAttemptFailure[]
}

export interface RetryOptions {
  readonly policy?: RetryPolicy
  readonly isRetryable?: (error: unknown) => boolean
  /** Injected so retry timing stays deterministic in tests; defaults to a real timer. */
  readonly sleep?: (delayMs: number) => Promise<void>
  readonly onRetry?: (failure: RetryAttemptFailure) => void
}

export function validateRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new RetryPolicyError('retry policy requires at least one attempt')
  }
  if (!Number.isFinite(policy.baseDelayMs) || policy.baseDelayMs < 0) {
    throw new RetryPolicyError('retry policy requires a non-negative base delay')
  }
  if (!Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs) {
    throw new RetryPolicyError('retry policy max delay must not be below the base delay')
  }
}

export function retryDelayMs(policy: RetryPolicy, attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RetryPolicyError('retry attempt must be a positive integer')
  }
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1))
}

/**
 * Transient renderer faults are retryable; a wrong backend or an impossible tile
 * plan is a caller defect and must fail loud on the first attempt.
 */
export function isRetryableImageError(error: unknown): boolean {
  if (error instanceof UnsupportedImageBackendError) return false
  if (error instanceof ImageTilePlanLimitError) return false
  return (
    error instanceof ImageRenderContextLostError || error instanceof ImageTextureMemoryBudgetError
  )
}

export async function runWithRetry<T>(
  operation: (attempt: number) => T | Promise<T>,
  options: RetryOptions = {}
): Promise<RetryReport<T>> {
  const policy = options.policy ?? IMAGE_RETRY_POLICY
  validateRetryPolicy(policy)
  const isRetryable = options.isRetryable ?? isRetryableImageError
  const sleep = options.sleep ?? defaultSleep
  const failures: RetryAttemptFailure[] = []

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return { value: await operation(attempt), attempts: attempt, failures }
    } catch (error) {
      if (!isRetryable(error)) throw error
      if (attempt === policy.maxAttempts) {
        throw new RetryExhaustedError(
          `image operation failed after ${attempt} attempts`,
          attempt,
          error
        )
      }
      const failure = { attempt, error, delayMs: retryDelayMs(policy, attempt) }
      failures.push(failure)
      options.onRetry?.(failure)
      await sleep(failure.delayMs)
    }
  }
  throw new RetryPolicyError('retry loop exited without a result')
}

/** Low-memory mode divides the render-buffer budget rather than inventing a new limit table. */
const LOW_MEMORY_TEXTURE_DIVISOR = 4

export interface ImageMemoryBudget {
  readonly profile: MemoryProfile
  readonly lowMemory: boolean
  readonly maxTextureBytes: number
  readonly maxResidentBytes: number
  readonly maxInputBytes: number
}

export function resolveImageMemoryBudget(
  profile: MemoryProfile,
  lowMemory = false
): ImageMemoryBudget {
  const limits = MEMORY_PROFILE_LIMITS[profile]
  return {
    profile,
    lowMemory,
    maxTextureBytes: lowMemory
      ? Math.floor(limits.maxRenderBufferBytes / LOW_MEMORY_TEXTURE_DIVISOR)
      : limits.maxRenderBufferBytes,
    maxResidentBytes: lowMemory
      ? Math.floor(limits.maxResidentBytes / LOW_MEMORY_TEXTURE_DIVISOR)
      : limits.maxResidentBytes,
    maxInputBytes: limits.maxInputBytes
  }
}

export interface ProgressiveOpenStage {
  readonly index: number
  readonly kind: 'proxy' | 'refine' | 'full'
  readonly plan: ImageTilePlan
  readonly interactive: boolean
}

export interface ProgressiveOpenPlan {
  readonly budget: ImageMemoryBudget
  readonly stages: readonly ProgressiveOpenStage[]
  /** True when the final stage renders at full source resolution. */
  readonly complete: boolean
}

export interface ProgressiveOpenOptions {
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly profile: MemoryProfile
  readonly lowMemory?: boolean
  readonly tileSize?: number
  /** Longest edge of the first interactive paint. */
  readonly firstPaintMaxDimension?: number
}

const DEFAULT_FIRST_PAINT_MAX_DIMENSION = 512

/**
 * Stages an open so the first paint is a small proxy the user can interact with,
 * then refines toward full resolution while every stage stays inside the budget.
 */
export function createProgressiveOpenPlan(options: ProgressiveOpenOptions): ProgressiveOpenPlan {
  const budget = resolveImageMemoryBudget(options.profile, options.lowMemory ?? false)
  const longestEdge = Math.max(options.sourceWidth, options.sourceHeight)
  const firstPaint = Math.min(
    options.firstPaintMaxDimension ?? DEFAULT_FIRST_PAINT_MAX_DIMENSION,
    longestEdge
  )
  const dimensions: number[] = []
  for (let edge = firstPaint; edge < longestEdge; edge *= 2) dimensions.push(edge)
  dimensions.push(longestEdge)

  const stages: ProgressiveOpenStage[] = []
  for (const proxyMaxDimension of dimensions) {
    const plan = tryTilePlan({
      sourceWidth: options.sourceWidth,
      sourceHeight: options.sourceHeight,
      proxyMaxDimension,
      maxTextureBytes: budget.maxTextureBytes,
      ...(options.tileSize === undefined ? {} : { tileSize: options.tileSize })
    })
    // A stage that cannot fit the budget ends refinement; earlier stages stay valid.
    if (!plan) break
    stages.push({
      index: stages.length,
      kind: stages.length === 0 ? 'proxy' : plan.scale >= 1 ? 'full' : 'refine',
      plan,
      interactive: stages.length === 0
    })
  }

  if (stages.length === 0) {
    throw new ImageTextureMemoryBudgetError(
      `no progressive open stage fits the ${budget.profile} texture budget of ${budget.maxTextureBytes} bytes`
    )
  }
  return {
    budget,
    stages,
    complete: (stages[stages.length - 1]?.plan.scale ?? 0) >= 1
  }
}

export interface ResilienceCycleReport {
  readonly cycles: number
  /** A lost context that rendered anyway, or a restore that recreated nothing. */
  readonly silentFailures: number
  readonly resourceGenerationStart: number
  readonly resourceGenerationEnd: number
  readonly contract: RendererResilienceContract
}

export interface LongSessionLeakReport {
  readonly samples: number
  readonly baselineTextures: number
  readonly peakTextures: number
  readonly baselineCommands: number
  readonly peakCommands: number
  /** Retained frame resources observed above the first sample. */
  readonly leakedResources: number
  readonly silentFailures: number
  readonly contract: RendererResilienceContract
}

/**
 * Proves the adapter does not grow its retained frame resource set during a
 * long render loop. Host heap/VRAM is intentionally outside this pure adapter
 * proof and remains UNKNOWN until a host-backed harness measures it.
 */
export function observeLongSessionLeakGuard(
  renderOnce: () => ImageRenderFrame,
  samples: number
): LongSessionLeakReport {
  if (!Number.isInteger(samples) || samples < 1) {
    throw new RangeError('long-session leak observation requires at least one sample')
  }
  const first = renderOnce()
  const baselineTextures = first.textures.length
  const baselineCommands = first.commands.length
  let peakTextures = baselineTextures
  let peakCommands = baselineCommands
  let silentFailures = first.gaps.length

  for (let sample = 1; sample < samples; sample += 1) {
    const frame = renderOnce()
    peakTextures = Math.max(peakTextures, frame.textures.length)
    peakCommands = Math.max(peakCommands, frame.commands.length)
    silentFailures += frame.gaps.length
  }

  const leakedResources =
    Math.max(0, peakTextures - baselineTextures) + Math.max(0, peakCommands - baselineCommands)
  const healthy = silentFailures === 0 && leakedResources === 0
  return {
    samples,
    baselineTextures,
    peakTextures,
    baselineCommands,
    peakCommands,
    leakedResources,
    silentFailures,
    contract: createRendererResilienceContract({
      longSessionLeakGuard: healthy ? 'SUPPORTED' : 'UNSUPPORTED'
    })
  }
}

/**
 * Drives real loss/restart cycles and derives the resilience contract from what
 * was observed. Nothing here reports SUPPORTED without exercising the path.
 */
export function observeContextLossCycles(
  adapter: ImageRenderAdapter,
  renderOnce: () => void,
  cycles: number
): ResilienceCycleReport {
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new RangeError('context loss cycle count must be a positive integer')
  }
  const resourceGenerationStart = adapter.resourceGeneration
  let silentFailures = 0

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    adapter.loseContext()
    const generationWhileLost = adapter.resourceGeneration
    try {
      renderOnce()
      silentFailures += 1
    } catch (error) {
      if (!(error instanceof ImageRenderContextLostError)) throw error
    }
    adapter.restore()
    if (adapter.resourceGeneration !== generationWhileLost + 1) silentFailures += 1
    renderOnce()
  }

  const resourceGenerationEnd = adapter.resourceGeneration
  const healthy = silentFailures === 0
  return {
    cycles,
    silentFailures,
    resourceGenerationStart,
    resourceGenerationEnd,
    contract: createRendererResilienceContract({
      contextRestoration: healthy ? 'SUPPORTED' : 'UNSUPPORTED',
      resourceRecreation: healthy ? 'SUPPORTED' : 'UNSUPPORTED'
    })
  }
}

export interface ResolutionDowngradeOptions {
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly budget: ImageMemoryBudget
  /** Measured resident bytes at the moment of the decision, never an assumed value. */
  readonly observedResidentBytes: number
  readonly requestedScale?: number
  readonly tileSize?: number
}

export interface ResolutionDowngradeDecision {
  readonly requestedScale: number
  readonly plan: ImageTilePlan
  readonly downgraded: boolean
  /** Texture bytes still available under the resident budget after the observed load. */
  readonly availableTextureBytes: number
}

/**
 * Chooses the largest render resolution that still fits the texture budget left
 * over after the observed resident load. Downgrade is derived from the measured
 * headroom, so a caller that never measures never silently gets full resolution.
 */
export function planResolutionDowngrade(
  options: ResolutionDowngradeOptions
): ResolutionDowngradeDecision {
  const observed = options.observedResidentBytes
  if (!Number.isFinite(observed) || observed < 0) {
    throw new RangeError('observed resident bytes must be a non-negative finite number')
  }
  const headroomBytes = options.budget.maxResidentBytes - observed
  const availableTextureBytes = Math.min(options.budget.maxTextureBytes, headroomBytes)
  if (availableTextureBytes < 4) {
    throw new ImageTextureMemoryBudgetError(
      `no texture headroom for a downgrade: ${availableTextureBytes} bytes available under the ${options.budget.profile} resident budget`
    )
  }
  const requestedScale = options.requestedScale ?? 1
  const plan = createImageTilePlan({
    sourceWidth: options.sourceWidth,
    sourceHeight: options.sourceHeight,
    scale: requestedScale,
    maxTextureBytes: Math.floor(availableTextureBytes),
    ...(options.tileSize === undefined ? {} : { tileSize: options.tileSize })
  })
  return {
    requestedScale,
    plan,
    downgraded: plan.scale < requestedScale,
    availableTextureBytes: Math.floor(availableTextureBytes)
  }
}

export interface ResolutionDowngradeReport {
  readonly samples: number
  readonly downgrades: number
  readonly recoveries: number
  /** Pressure that should have downgraded and did not, or a plan that overran its budget. */
  readonly silentFailures: number
  readonly decisions: readonly ResolutionDowngradeDecision[]
  readonly contract: RendererResilienceContract
}

/**
 * Drives the downgrade path across measured pressure samples and derives the
 * resilience contract from what was observed. `SUPPORTED` is never asserted:
 * it only appears when every sampled decision behaved.
 */
export function observeResolutionDowngrade(
  options: Omit<ResolutionDowngradeOptions, 'observedResidentBytes'>,
  observedResidentByteSamples: readonly number[]
): ResolutionDowngradeReport {
  if (observedResidentByteSamples.length === 0) {
    throw new RangeError('resolution downgrade observation requires at least one sample')
  }
  const requestedScale = options.requestedScale ?? 1
  const decisions: ResolutionDowngradeDecision[] = []
  let downgrades = 0
  let recoveries = 0
  let silentFailures = 0
  let previousScale: number | undefined

  for (const observedResidentBytes of observedResidentByteSamples) {
    const decision = planResolutionDowngrade({ ...options, observedResidentBytes })
    decisions.push(decision)

    const fullResolutionBytes = fullResolutionByteCost(
      options.sourceWidth,
      options.sourceHeight,
      requestedScale
    )
    // Pressure that leaves less headroom than full resolution needs must downgrade.
    if (fullResolutionBytes > decision.availableTextureBytes && !decision.downgraded) {
      silentFailures += 1
    }
    if (decision.plan.estimatedBytes > decision.availableTextureBytes) silentFailures += 1
    if (decision.downgraded) downgrades += 1
    if (previousScale !== undefined && decision.plan.scale > previousScale) recoveries += 1
    previousScale = decision.plan.scale
  }

  const healthy = silentFailures === 0 && downgrades > 0
  return {
    samples: observedResidentByteSamples.length,
    downgrades,
    recoveries,
    silentFailures,
    decisions,
    contract: createRendererResilienceContract({
      resolutionDowngrade: healthy ? 'SUPPORTED' : 'UNSUPPORTED'
    })
  }
}

function fullResolutionByteCost(sourceWidth: number, sourceHeight: number, scale: number): number {
  return (
    Math.max(1, Math.ceil(sourceWidth * scale)) * Math.max(1, Math.ceil(sourceHeight * scale)) * 4
  )
}

function tryTilePlan(options: {
  sourceWidth: number
  sourceHeight: number
  proxyMaxDimension: number
  maxTextureBytes: number
  tileSize?: number
}): ImageTilePlan | undefined {
  try {
    return createImageTilePlan(options)
  } catch (error) {
    if (error instanceof ImageTextureMemoryBudgetError) return undefined
    throw error
  }
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}
