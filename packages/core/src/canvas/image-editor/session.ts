import type { CompositionPlan } from '#core/canvas/composition'
import type { AssetId, AssetRevision } from '#core/editor/assets'
import type { MemoryProfile } from '#core/io/transactional/protocol'

import { createImageRenderAdapter, type ImageRenderAdapterOptions } from './adapter'
import {
  createProgressiveOpenPlan,
  isRetryableImageError,
  planResolutionDowngrade,
  resolveImageMemoryBudget,
  runWithRetry,
  type ProgressiveOpenStage,
  type ResolutionDowngradeDecision,
  type RetryAttemptFailure,
  type RetryOptions
} from './resilience'
import type { ImageRenderFrame, ImageRevisionResolver } from './types'

export class ImageResilienceSessionBusyError extends Error {
  readonly code = 'E_IMAGE_RESILIENCE_SESSION_BUSY'
  override readonly name = 'ImageResilienceSessionBusyError'
}

export class ImageResilienceSourceError extends Error {
  readonly code = 'E_IMAGE_RESILIENCE_SOURCE'
  override readonly name = 'ImageResilienceSourceError'
}

export interface ImageResilienceStageReport {
  readonly stage: ProgressiveOpenStage
  readonly frame: ImageRenderFrame
  readonly emittedScale: number
  readonly attempts: number
  readonly failures: readonly RetryAttemptFailure[]
}

export interface ImageResilienceOpenReport {
  readonly stages: readonly ImageResilienceStageReport[]
  readonly sourceAttempts: number
  readonly sourceFailures: readonly RetryAttemptFailure[]
  readonly complete: boolean
  readonly finalScale: number
}

export interface ImageResilienceRenderReport {
  readonly frame: ImageRenderFrame
  readonly decision: ResolutionDowngradeDecision
  readonly emittedScale: number
  readonly fullResolution: boolean
  readonly sourceAttempts: number
  readonly sourceFailures: readonly RetryAttemptFailure[]
  readonly attempts: number
  readonly failures: readonly RetryAttemptFailure[]
}

export interface ImageResilienceSessionOptions {
  readonly adapter?: ImageRenderAdapterOptions
  readonly profile: MemoryProfile
  readonly lowMemory?: boolean
  readonly firstPaintMaxDimension?: number
  readonly retry?: RetryOptions
  readonly onProgressiveStage?: (report: ImageResilienceStageReport) => void
  readonly onResolutionDecision?: (report: ImageResilienceRenderReport) => void
}

export interface ImageProgressiveOpenOptions {
  readonly signal?: AbortSignal
}

export interface ImageMeasuredRenderOptions extends ImageProgressiveOpenOptions {
  readonly observedResidentBytes: number
  readonly requestedScale?: number
}

export interface ImageResilienceSession {
  readonly busy: boolean
  open(
    plan: CompositionPlan,
    resolve: ImageRevisionResolver,
    options: ImageProgressiveOpenOptions
  ): Promise<ImageResilienceOpenReport>
  render(
    plan: CompositionPlan,
    resolve: ImageRevisionResolver,
    options: ImageMeasuredRenderOptions
  ): Promise<ImageResilienceRenderReport>
}

export function createImageResilienceSession(
  options: ImageResilienceSessionOptions
): ImageResilienceSession {
  let busy = false

  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (busy) throw new ImageResilienceSessionBusyError('image resilience session is busy')
    busy = true
    try {
      return await operation()
    } finally {
      busy = false
    }
  }

  return {
    get busy(): boolean {
      return busy
    },
    open(plan, resolve, openOptions) {
      return exclusive(async () => {
        const source = await resolveSourceWithRetry(
          plan,
          resolve,
          options.retry,
          openOptions.signal
        )
        const progressive = createProgressiveOpenPlan({
          sourceWidth: source.value.width,
          sourceHeight: source.value.height,
          profile: options.profile,
          ...(options.lowMemory === undefined ? {} : { lowMemory: options.lowMemory }),
          ...(options.adapter?.tileSize === undefined
            ? {}
            : { tileSize: options.adapter.tileSize }),
          ...(options.firstPaintMaxDimension === undefined
            ? {}
            : { firstPaintMaxDimension: options.firstPaintMaxDimension })
        })
        const reports: ImageResilienceStageReport[] = []

        for (const stage of progressive.stages) {
          openOptions.signal?.throwIfAborted()
          const adapter = createImageRenderAdapter({
            ...options.adapter,
            proxyMaxDimension: Math.max(stage.plan.renderWidth, stage.plan.renderHeight),
            maxTextureBytes: progressive.budget.maxTextureBytes
          })
          const retry = await runWithRetry(
            () => {
              openOptions.signal?.throwIfAborted()
              return adapter.render(plan, source.value.resolve)
            },
            retryOptions(options.retry, openOptions.signal)
          )
          openOptions.signal?.throwIfAborted()
          const report = {
            stage,
            frame: retry.value,
            emittedScale: emittedFrameScale(retry.value, source.value),
            attempts: retry.attempts,
            failures: retry.failures
          }
          reports.push(report)
          options.onProgressiveStage?.(report)
        }

        const finalScale = reports[reports.length - 1]?.emittedScale ?? 0
        return {
          stages: reports,
          sourceAttempts: source.attempts,
          sourceFailures: source.failures,
          complete: finalScale >= 1,
          finalScale
        }
      })
    },
    render(plan, resolve, renderOptions) {
      return exclusive(async () => {
        renderOptions.signal?.throwIfAborted()
        const source = await resolveSourceWithRetry(
          plan,
          resolve,
          options.retry,
          renderOptions.signal
        )
        const decision = planResolutionDowngrade({
          sourceWidth: source.value.width,
          sourceHeight: source.value.height,
          budget: resolveImageMemoryBudget(options.profile, options.lowMemory ?? false),
          observedResidentBytes: renderOptions.observedResidentBytes,
          ...(renderOptions.requestedScale === undefined
            ? {}
            : { requestedScale: renderOptions.requestedScale }),
          ...(options.adapter?.tileSize === undefined ? {} : { tileSize: options.adapter.tileSize })
        })
        const adapter = createImageRenderAdapter({
          ...options.adapter,
          proxyMaxDimension: Math.max(decision.plan.renderWidth, decision.plan.renderHeight),
          maxTextureBytes: decision.availableTextureBytes
        })
        const retry = await runWithRetry(
          () => {
            renderOptions.signal?.throwIfAborted()
            return adapter.render(plan, source.value.resolve)
          },
          retryOptions(options.retry, renderOptions.signal)
        )
        renderOptions.signal?.throwIfAborted()
        const emittedScale = emittedFrameScale(retry.value, source.value)
        const report = {
          frame: retry.value,
          decision,
          emittedScale,
          fullResolution: emittedScale >= 1,
          sourceAttempts: source.attempts,
          sourceFailures: source.failures,
          attempts: retry.attempts,
          failures: retry.failures
        }
        options.onResolutionDecision?.(report)
        return report
      })
    }
  }
}

interface ResolvedSource {
  readonly width: number
  readonly height: number
  readonly assetIds: ReadonlySet<AssetId>
  readonly resolve: ImageRevisionResolver
}

async function resolveSourceWithRetry(
  plan: CompositionPlan,
  resolve: ImageRevisionResolver,
  options: RetryOptions | undefined,
  signal: AbortSignal | undefined
) {
  return runWithRetry(
    () => {
      signal?.throwIfAborted()
      return resolveSource(plan, resolve)
    },
    retryOptions(options, signal)
  )
}

function resolveSource(plan: CompositionPlan, resolve: ImageRevisionResolver): ResolvedSource {
  const bindings = new Map<AssetId, { assetId: AssetId; revisionId: string }>()
  const revisions = new Map<string, AssetRevision>()

  for (const node of plan.nodes.values()) {
    if (!node.visible) continue
    for (const assetId of node.assetIds) {
      if (bindings.has(assetId)) continue
      if (bindings.size > 0) {
        throw new ImageResilienceSourceError(
          'image resilience session requires exactly one visible bound image asset'
        )
      }
      const binding = resolve.getAsset(assetId)
      if (!binding)
        throw new ImageResilienceSourceError(`image asset binding is missing: ${assetId}`)
      if (binding.assetId !== assetId) {
        throw new ImageResilienceSourceError(`image asset binding does not match: ${assetId}`)
      }
      const revision = resolve.getRevision(binding.revisionId)
      if (!revision) {
        throw new ImageResilienceSourceError(
          `image asset revision is missing: ${binding.revisionId}`
        )
      }
      if (revision.revisionId !== binding.revisionId) {
        throw new ImageResilienceSourceError(
          `image asset revision does not match: ${binding.revisionId}`
        )
      }
      const revisionWidth = revision.metadata.width
      const revisionHeight = revision.metadata.height
      if (
        !Number.isSafeInteger(revisionWidth) ||
        !Number.isSafeInteger(revisionHeight) ||
        (revisionWidth as number) <= 0 ||
        (revisionHeight as number) <= 0
      ) {
        throw new ImageResilienceSourceError(
          `image revision dimensions are invalid: ${binding.revisionId}`
        )
      }
      bindings.set(assetId, binding)
      revisions.set(binding.revisionId, revision)
    }
  }

  const binding = bindings.values().next().value
  const revision = binding ? revisions.get(binding.revisionId) : undefined
  if (!binding || !revision) {
    throw new ImageResilienceSourceError('no visible bound image revision is available')
  }
  return {
    width: revision.metadata.width as number,
    height: revision.metadata.height as number,
    assetIds: new Set(bindings.keys()),
    resolve: {
      getAsset: (assetId) => bindings.get(assetId),
      getRevision: (revisionId) => revisions.get(revisionId)
    }
  }
}

function emittedFrameScale(frame: ImageRenderFrame, source: ResolvedSource): number {
  const textures = frame.textures.filter((texture) => source.assetIds.has(texture.assetId))
  if (textures.length !== source.assetIds.size) {
    throw new ImageResilienceSourceError(
      `render emitted ${textures.length} of ${source.assetIds.size} resolved image textures`
    )
  }
  const scales = textures.map((texture) => {
    const tilePlan = texture.tilePlan
    if (
      !tilePlan ||
      tilePlan.sourceWidth !== source.width ||
      tilePlan.sourceHeight !== source.height
    ) {
      throw new ImageResilienceSourceError(
        `render texture plan does not match resolved ${source.width}x${source.height} source`
      )
    }
    return tilePlan.scale
  })
  const scale = scales[0]
  if (scale === undefined || scales.some((value) => value !== scale)) {
    throw new ImageResilienceSourceError('render emitted heterogeneous texture scales')
  }
  return scale
}

function retryOptions(options: RetryOptions | undefined, signal: AbortSignal | undefined) {
  const isRetryable = options?.isRetryable ?? isRetryableImageError
  return {
    ...options,
    isRetryable: (error: unknown) =>
      signal?.aborted !== true && !(error instanceof DOMException && error.name === 'AbortError')
        ? isRetryable(error)
        : false
  }
}
