import type { CompositionNode, CompositionPlan } from '#core/canvas/composition'
import type { AssetId, AssetRevision } from '#core/editor/assets'
import {
  createRasterEffectAdjustment,
  isAdjustmentLayerKind,
  validateEffectStack,
  validateEffectFilter,
  type AdjustmentLayerKind,
  type EffectFilter,
  type EffectKind,
  type EffectStack
} from '#core/editor/image-capabilities/effects'

export type RasterPixelFormat =
  | 'rgba8-srgb'
  | 'rgba16f-linear-premultiplied'
  | 'rgba32f-linear-premultiplied'

export type RasterBackend = 'canvas2d' | 'webgl2' | 'webgpu' | 'skia'
export type RasterCapabilityState = 'SUPPORTED' | 'UNKNOWN' | 'UNSUPPORTED'

export interface RasterParityThresholds {
  readonly maxChannelDelta: number
  readonly maxMeanBias: number
}

export interface RasterBackendCapability {
  readonly version: 'raster-backend-capability-v1'
  readonly backend: RasterBackend
  readonly format: RasterPixelFormat
  readonly state: RasterCapabilityState
  readonly equivalence: 'PARITY_PROVEN' | 'NON_EQUIVALENT' | 'UNKNOWN'
  readonly parity: RasterParityThresholds
  readonly gaps: readonly RasterUnsupportedGap[]
}

export type RasterUnsupportedGapCode =
  | 'rgba16f-unavailable'
  | 'skia-oracle-unavailable'
  | 'backend-unavailable'
  | 'malformed-rgba8'

export interface RasterUnsupportedGap {
  readonly code: RasterUnsupportedGapCode
  readonly message: string
  readonly assetId?: AssetId
}

export interface RasterCompositionUnsupported {
  readonly status: 'UNSUPPORTED'
  readonly format: RasterPixelFormat
  readonly backend: RasterBackend
  readonly capability: RasterBackendCapability
  readonly gaps: readonly RasterUnsupportedGap[]
  readonly pixels?: never
}

export interface RasterCompositionPixels {
  readonly status: 'SUPPORTED'
  readonly format: 'rgba8-srgb'
  readonly backend: RasterBackend
  readonly capability: RasterBackendCapability
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
  readonly gaps: readonly RasterUnsupportedGap[]
}

export type RasterCompositionResult = RasterCompositionPixels | RasterCompositionUnsupported

export interface RasterCompositionAssetResolver {
  getAsset(assetId: AssetId): { assetId: AssetId; revisionId: string } | undefined
  getRevision(revisionId: string): AssetRevision | undefined
}

export type RasterAdjustment = (
  pixel: readonly [number, number, number, number],
  node: CompositionNode
) => readonly [number, number, number, number]

export interface RasterCompositionOptions {
  readonly width: number
  readonly height: number
  readonly adjustments?: Readonly<Record<string, RasterAdjustment>>
  readonly adjustmentLayerAdjustments?: Readonly<
    Partial<Record<AdjustmentLayerKind, RasterAdjustment>>
  >
  /**
   * Typed effect filters consumed by the CPU reference when no host callback
   * is supplied. Areas are expressed in output pixels.
   */
  readonly effectFilters?: readonly EffectFilter[]
  /**
   * Layer- or group-scoped, ordered effect stacks. Smart stacks remain
   * non-destructive: the source pixels are read again for every composition.
   */
  readonly effectStacks?: readonly EffectStack[]
  readonly backend?: RasterBackend
  readonly parity?: Partial<RasterParityThresholds>
  /**
   * Caller-owned revision for opaque adjustment callbacks. Callback identity
   * cannot be serialized, so callers must advance this when behavior changes.
   */
  readonly adjustmentSignature?: string
  /**
   * Optional per-raster-node CPU cache. It stays cold until a measured render
   * miss crosses the threshold, avoiding cache overhead for small documents.
   * The cache stores individual raster-node buffers, not group render passes.
   */
  readonly groupCache?: RasterGroupCache
  /**
   * Optional threshold-gated scratch canvases for sequential raster nodes.
   * The output canvas remains fresh for every composition.
   */
  readonly canvasPool?: RasterCanvasPool
  readonly now?: () => number
}

/**
 * Cache for individual raster-node buffers. Despite the field's historical
 * `groupCache` name, this is not a group-scoped render cache.
 */
export interface RasterGroupCache {
  get(key: string): RasterCachedNode | undefined
  recordMiss(key: string, elapsedMs: number, value: RasterCachedNode): void
  clear(): void
}

export interface RasterCanvas {
  readonly pixels: Uint8Array
  readonly present: Uint8Array
}

type RasterCachedNode = RasterCanvas

export interface RasterCanvasPool {
  acquire(width: number, height: number): RasterCanvas | undefined
  recordMiss(width: number, height: number, elapsedMs: number, value: RasterCanvas): void
  release(width: number, height: number, value: RasterCanvas): void
  clear(): void
}

function rasterCanvasSize(width: number, height: number): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(width * height)
  ) {
    throw new RangeError('canvas pool dimensions must be positive safe integers')
  }
  return width * height
}

function validateRasterCanvas(width: number, height: number, value: RasterCanvas): void {
  const size = rasterCanvasSize(width, height)
  if (value.pixels.length !== size * 4 || value.present.length !== size) {
    throw new RangeError('canvas pool buffers do not match their dimensions')
  }
}

const adjustmentIds = new WeakMap<RasterAdjustment, number>()
let nextAdjustmentId = 1

function adjustmentId(adjustment: RasterAdjustment): number {
  const existing = adjustmentIds.get(adjustment)
  if (existing !== undefined) return existing
  const id = nextAdjustmentId
  nextAdjustmentId += 1
  adjustmentIds.set(adjustment, id)
  return id
}

function createPixelBuffer(size: number): Uint8Array {
  return new Uint8Array(size)
}

export function createRasterGroupCache(thresholdMs = 50): RasterGroupCache {
  if (!Number.isFinite(thresholdMs) || thresholdMs < 0) {
    throw new RangeError('group cache threshold must be a finite non-negative number')
  }
  const entries = new Map<string, RasterCachedNode>()
  const enabled = new Set<string>()
  return {
    get(key) {
      if (!enabled.has(key)) return undefined
      const value = entries.get(key)
      return value ? { pixels: value.pixels.slice(), present: value.present.slice() } : undefined
    },
    recordMiss(key, elapsedMs, value) {
      if (!Number.isFinite(elapsedMs) || elapsedMs < thresholdMs) return
      enabled.add(key)
      entries.set(key, {
        pixels: value.pixels.slice(),
        present: value.present.slice()
      })
    },
    clear() {
      entries.clear()
      enabled.clear()
    }
  }
}

export function createRasterCanvasPool(thresholdMs = 50): RasterCanvasPool {
  if (!Number.isFinite(thresholdMs) || thresholdMs < 0) {
    throw new RangeError('canvas pool threshold must be a finite non-negative number')
  }
  const available = new Map<string, RasterCanvas>()
  const enabled = new Set<string>()
  const keyFor = (width: number, height: number) => `${width}x${height}`
  return {
    acquire(width, height) {
      rasterCanvasSize(width, height)
      const key = keyFor(width, height)
      if (!enabled.has(key)) return undefined
      const value = available.get(key)
      if (!value) return undefined
      available.delete(key)
      return value
    },
    recordMiss(width, height, elapsedMs, value) {
      validateRasterCanvas(width, height, value)
      if (!Number.isFinite(elapsedMs) || elapsedMs < thresholdMs) return
      const key = keyFor(width, height)
      enabled.add(key)
      if (!available.has(key)) available.set(key, value)
    },
    release(width, height, value) {
      validateRasterCanvas(width, height, value)
      const key = keyFor(width, height)
      if (enabled.has(key) && !available.has(key)) available.set(key, value)
    },
    clear() {
      available.clear()
      enabled.clear()
    }
  }
}

export class RasterCompositionError extends Error {
  readonly code: string = 'E_RASTER_COMPOSITION'
}

export class RasterBackendUnavailableError extends RasterCompositionError {
  readonly code = 'E_RASTER_BACKEND_UNAVAILABLE'
}

export const RASTER_RGBA8_PARITY: RasterParityThresholds = {
  maxChannelDelta: 1 / 255,
  maxMeanBias: 1 / 255
}

function capability(
  backend: RasterBackend,
  state: RasterCapabilityState,
  equivalence: RasterBackendCapability['equivalence'],
  gaps: readonly RasterUnsupportedGap[],
  parity: Partial<RasterParityThresholds> = {}
): RasterBackendCapability {
  return {
    version: 'raster-backend-capability-v1',
    backend,
    format: 'rgba8-srgb',
    state,
    equivalence,
    parity: { ...RASTER_RGBA8_PARITY, ...parity },
    gaps
  }
}

export function validateRasterBackendCapability(capability: RasterBackendCapability): void {
  if (
    capability.version !== 'raster-backend-capability-v1' ||
    !['canvas2d', 'webgl2', 'webgpu', 'skia'].includes(capability.backend) ||
    !['rgba8-srgb', 'rgba16f-linear-premultiplied'].includes(capability.format) ||
    !['SUPPORTED', 'UNKNOWN', 'UNSUPPORTED'].includes(capability.state) ||
    !['PARITY_PROVEN', 'NON_EQUIVALENT', 'UNKNOWN'].includes(capability.equivalence) ||
    !Number.isFinite(capability.parity.maxChannelDelta) ||
    !Number.isFinite(capability.parity.maxMeanBias)
  ) {
    throw new RasterCompositionError('invalid raster backend capability')
  }
}

function numberMetadata(revision: AssetRevision, key: string): number | undefined {
  const value = revision.metadata[key]
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function formatMetadata(revision: AssetRevision): RasterPixelFormat {
  if (revision.metadata.format === 'rgba16f-linear-premultiplied') {
    return 'rgba16f-linear-premultiplied'
  }
  if (revision.metadata.format === 'rgba32f-linear-premultiplied') {
    return 'rgba32f-linear-premultiplied'
  }
  return 'rgba8-srgb'
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  const clamped = Math.min(1, Math.max(0, value))
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055
}

function blendOver(
  output: Uint8Array,
  outputIndex: number,
  source: readonly [number, number, number, number],
  opacity: number
): void {
  const sourceAlpha = (source[3] / 255) * opacity
  if (sourceAlpha <= 0) return
  const destinationAlpha = (output[outputIndex + 3] ?? 0) / 255
  const resultAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)
  if (resultAlpha <= 0) return
  for (let channel = 0; channel < 3; channel += 1) {
    const sourceColor = srgbToLinear(source[channel] / 255)
    const destinationColor = srgbToLinear((output[outputIndex + channel] ?? 0) / 255)
    const result =
      (sourceColor * sourceAlpha + destinationColor * destinationAlpha * (1 - sourceAlpha)) /
      resultAlpha
    output[outputIndex + channel] = Math.round(linearToSrgb(result) * 255)
  }
  output[outputIndex + 3] = Math.round(resultAlpha * 255)
}

function pointInRotatedNode(
  node: CompositionNode,
  x: number,
  y: number
): { x: number; y: number } | undefined {
  const { x: originX, y: originY, width, height } = node.bounds
  if (width <= 0 || height <= 0) return undefined
  const radians = (-node.rotation * Math.PI) / 180
  const centerX = originX + width / 2
  const centerY = originY + height / 2
  const dx = x - centerX
  const dy = y - centerY
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians) + width / 2
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians) + height / 2
  if (localX < 0 || localY < 0 || localX >= width || localY >= height) return undefined
  return { x: localX, y: localY }
}

function withinClips(plan: CompositionPlan, node: CompositionNode, x: number, y: number): boolean {
  let parentId = node.parentId
  while (parentId) {
    const parent = plan.nodes.get(parentId)
    if (!parent) break
    if (parent.clipsContent && !pointInRotatedNode(parent, x, y)) return false
    parentId = parent.parentId
  }
  return true
}

function maskAlpha(plan: CompositionPlan, node: CompositionNode, x: number, y: number): number {
  let parentId = node.parentId
  while (parentId) {
    const parent = plan.nodes.get(parentId)
    if (!parent) break
    if (parent.maskType && !pointInRotatedNode(parent, x, y)) return 0
    const childIndex = parent.childIds.indexOf(node.nodeId)
    if (childIndex > 0) {
      let maskIndex = childIndex - 1
      const siblingMasks: CompositionNode[] = []
      while (maskIndex >= 0) {
        const siblingId = parent.childIds[maskIndex]
        const sibling = siblingId ? plan.nodes.get(siblingId) : undefined
        if (!sibling?.visible || !sibling.maskType) break
        siblingMasks.push(sibling)
        maskIndex -= 1
      }
      if (siblingMasks.some((mask) => !pointInRotatedNode(mask, x, y))) {
        return 0
      }
    }
    if (childIndex < 0) break
    node = parent
    parentId = parent.parentId
  }
  return 1
}

function sourcePixel(
  bytes: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
): readonly [number, number, number, number] {
  const sourceX = Math.min(width - 1, Math.max(0, Math.floor(x)))
  const sourceY = Math.min(height - 1, Math.max(0, Math.floor(y)))
  const index = (sourceY * width + sourceX) * 4
  return [bytes[index] ?? 0, bytes[index + 1] ?? 0, bytes[index + 2] ?? 0, bytes[index + 3] ?? 0]
}

function isWithinNodeOrDescendant(
  plan: CompositionPlan,
  node: CompositionNode,
  ancestorId: string
): boolean {
  let current: CompositionNode | undefined = node
  while (current) {
    if (current.nodeId === ancestorId) return true
    current = current.parentId ? plan.nodes.get(current.parentId) : undefined
  }
  return false
}

function rasterNodeCacheKey(
  plan: CompositionPlan,
  node: CompositionNode,
  revisionId: string,
  options: RasterCompositionOptions,
  adjustmentCallbacks: readonly number[]
): string {
  const ancestors: string[] = []
  let current: CompositionNode | undefined = node
  while (current) {
    const parent = current.parentId ? plan.nodes.get(current.parentId) : undefined
    const childIndex = parent ? parent.childIds.indexOf(current.nodeId) : -1
    const precedingMasks: string[] = []
    for (let index = childIndex - 1; index >= 0; index -= 1) {
      const siblingId = parent?.childIds[index]
      const sibling = siblingId ? plan.nodes.get(siblingId) : undefined
      if (!sibling?.visible || !sibling.maskType) break
      precedingMasks.push(
        JSON.stringify([
          sibling.nodeId,
          sibling.visible,
          sibling.rotation,
          sibling.bounds,
          sibling.maskType,
          sibling.maskIsOutline
        ])
      )
    }
    ancestors.push(
      JSON.stringify([
        current.nodeId,
        current.parentId,
        current.visible,
        current.opacity,
        current.inheritedOpacity,
        current.blendMode,
        current.clipsContent,
        current.rotation,
        current.bounds,
        current.maskType,
        current.maskIsOutline,
        precedingMasks
      ])
    )
    current = current.parentId ? plan.nodes.get(current.parentId) : undefined
  }
  return JSON.stringify({
    node: node.nodeId,
    revisionId,
    width: options.width,
    height: options.height,
    ancestors,
    adjustmentHooks: node.adjustmentHooks,
    adjustmentSignature: options.adjustmentSignature,
    adjustmentCallbacks
  })
}

function rasterAdjustmentCallbacks(
  node: CompositionNode,
  options: RasterCompositionOptions
): readonly RasterAdjustment[] {
  return node.adjustmentHooks.flatMap((hook) => {
    const effectKind = hook as EffectKind
    const adjustment =
      options.adjustments?.[hook] ??
      (isAdjustmentLayerKind(effectKind)
        ? options.adjustmentLayerAdjustments?.[effectKind]
        : undefined)
    return adjustment ? [adjustment] : []
  })
}

function effectMaskContainsPixel(
  plan: CompositionPlan,
  stack: EffectStack,
  x: number,
  y: number
): boolean {
  if (stack.effectMaskIds.length === 0) return true
  return stack.effectMaskIds.every((maskId) => {
    const mask = plan.nodes.get(maskId)
    return mask !== undefined && pointInRotatedNode(mask, x + 0.5, y + 0.5) !== undefined
  })
}

function validateEffectArea(effect: EffectFilter, width: number, height: number): void {
  const [x, y, areaWidth, areaHeight] = effect.affectedArea
  if (
    x + areaWidth > width ||
    y + areaHeight > height ||
    (areaWidth * areaHeight) / (width * height) > 0.25
  ) {
    throw new RasterCompositionError('effect area exceeds bounded pixel contract')
  }
}

function blurPixels(
  source: Uint8Array,
  present: Uint8Array,
  width: number,
  height: number,
  effect: EffectFilter,
  eligible: (x: number, y: number) => boolean = () => true
): Uint8Array {
  const output = source.slice()
  const [x, y, areaWidth, areaHeight] = effect.affectedArea
  const radius = Math.max(0, Math.floor(effect.adjustments?.radius ?? 1))
  if (radius === 0) return output
  for (let outputY = y; outputY < y + areaHeight; outputY += 1) {
    for (let outputX = x; outputX < x + areaWidth; outputX += 1) {
      const outputIndex = (outputY * width + outputX) * 4
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let samples = 0
      for (
        let sampleY = Math.max(0, outputY - radius);
        sampleY <= Math.min(height - 1, outputY + radius);
        sampleY += 1
      ) {
        for (
          let sampleX = Math.max(0, outputX - radius);
          sampleX <= Math.min(width - 1, outputX + radius);
          sampleX += 1
        ) {
          const sampleIndex = (sampleY * width + sampleX) * 4
          if (present[sampleY * width + sampleX] === 0 || !eligible(sampleX, sampleY)) continue
          red += source[sampleIndex] ?? 0
          green += source[sampleIndex + 1] ?? 0
          blue += source[sampleIndex + 2] ?? 0
          alpha += source[sampleIndex + 3] ?? 0
          samples += 1
        }
      }
      if (samples > 0) {
        output[outputIndex] = Math.round(red / samples)
        output[outputIndex + 1] = Math.round(green / samples)
        output[outputIndex + 2] = Math.round(blue / samples)
        output[outputIndex + 3] = Math.round(alpha / samples)
      }
    }
  }
  return output
}

function applyRasterEffect(
  pixels: Uint8Array,
  present: Uint8Array,
  width: number,
  height: number,
  effect: EffectFilter,
  eligible: (x: number, y: number) => boolean = () => true
): Uint8Array {
  if (effect.kind === 'blur') return blurPixels(pixels, present, width, height, effect, eligible)
  const output = pixels.slice()
  const [x, y, areaWidth, areaHeight] = effect.affectedArea
  const adjustment = createRasterEffectAdjustment(effect.kind, effect.adjustments)
  for (let outputY = y; outputY < y + areaHeight; outputY += 1) {
    for (let outputX = x; outputX < x + areaWidth; outputX += 1) {
      if (present[outputY * width + outputX] === 0 || !eligible(outputX, outputY)) continue
      const index = (outputY * width + outputX) * 4
      const pixel = adjustment([
        pixels[index] ?? 0,
        pixels[index + 1] ?? 0,
        pixels[index + 2] ?? 0,
        pixels[index + 3] ?? 0
      ])
      output[index] = pixel[0]
      output[index + 1] = pixel[1]
      output[index + 2] = pixel[2]
      output[index + 3] = pixel[3]
    }
  }
  return output
}

export function composeRasterRGBA8(
  plan: CompositionPlan,
  resolve: RasterCompositionAssetResolver,
  options: RasterCompositionOptions
): RasterCompositionPixels {
  if (options.backend !== undefined && options.backend !== 'canvas2d') {
    throw new RasterBackendUnavailableError(
      `RGBA8 compositor cannot claim ${options.backend} backend support`
    )
  }
  if (
    !Number.isInteger(options.width) ||
    !Number.isInteger(options.height) ||
    options.width <= 0 ||
    options.height <= 0
  ) {
    throw new RasterCompositionError('invalid RGBA8 output dimensions')
  }
  for (const effect of options.effectFilters ?? []) {
    validateEffectFilter(effect)
    validateEffectArea(effect, options.width, options.height)
  }
  for (const stack of options.effectStacks ?? []) {
    validateEffectStack(stack)
    for (const effect of stack.filters) validateEffectArea(effect, options.width, options.height)
  }
  const pixels = new Uint8Array(options.width * options.height * 4)
  const gaps: RasterUnsupportedGap[] = []
  const now = options.now ?? (() => performance.now())
  for (const node of plan.nodes.values()) {
    if (!node.visible || node.maskType || node.assetIds.length === 0) continue
    const assetId = node.assetIds[0]
    if (!assetId) continue
    const binding = resolve.getAsset(assetId)
    const revision = binding && resolve.getRevision(binding.revisionId)
    if (!binding || !revision) continue
    const format = formatMetadata(revision)
    if (format === 'rgba16f-linear-premultiplied') {
      gaps.push({
        code: 'rgba16f-unavailable',
        message: 'RGBA16F composition is unavailable',
        assetId
      })
      continue
    }
    if (format === 'rgba32f-linear-premultiplied') {
      gaps.push({
        code: 'rgba32f-unavailable',
        message: 'RGBA32F composition is unavailable',
        assetId
      })
      continue
    }
    const sourceWidth = numberMetadata(revision, 'width')
    const sourceHeight = numberMetadata(revision, 'height')
    if (
      !sourceWidth ||
      !sourceHeight ||
      revision.bytes.byteLength !== sourceWidth * sourceHeight * 4
    ) {
      gaps.push({
        code: 'malformed-rgba8',
        message: 'RGBA8 asset metadata or byte length is invalid',
        assetId
      })
      continue
    }
    const adjustmentCallbacks = rasterAdjustmentCallbacks(node, options)
    const groupCache = options.groupCache
    const cacheEnabled =
      groupCache !== undefined &&
      (adjustmentCallbacks.length === 0 || options.adjustmentSignature !== undefined)
    const cacheKey = rasterNodeCacheKey(
      plan,
      node,
      binding.revisionId,
      options,
      adjustmentCallbacks.map(adjustmentId)
    )
    let cached = cacheEnabled ? groupCache.get(cacheKey) : undefined
    let scratch: RasterCanvas | undefined
    if (!cached) {
      const startedAt = now()
      const { width, height } = node.bounds
      scratch = options.canvasPool?.acquire(options.width, options.height)
      const present = scratch?.present ?? new Uint8Array(options.width * options.height)
      const nodePixels = scratch?.pixels ?? createPixelBuffer(options.width * options.height * 4)
      if (scratch) {
        present.fill(0)
        nodePixels.fill(0)
      }
      for (let outputY = 0; outputY < options.height; outputY += 1) {
        for (let outputX = 0; outputX < options.width; outputX += 1) {
          const local = pointInRotatedNode(node, outputX + 0.5, outputY + 0.5)
          if (!local || !withinClips(plan, node, outputX + 0.5, outputY + 0.5)) continue
          const alpha = maskAlpha(plan, node, outputX + 0.5, outputY + 0.5)
          if (alpha === 0) continue
          let pixel = sourcePixel(
            revision.bytes,
            sourceWidth,
            sourceHeight,
            (local.x / width) * sourceWidth,
            (local.y / height) * sourceHeight
          )
          for (const hook of node.adjustmentHooks) {
            const effectKind = hook as EffectKind
            const adjustment =
              options.adjustments?.[hook] ??
              (isAdjustmentLayerKind(effectKind)
                ? options.adjustmentLayerAdjustments?.[effectKind]
                : undefined)
            if (adjustment) pixel = adjustment(pixel, node)
          }
          const index = (outputY * options.width + outputX) * 4
          nodePixels[index] = pixel[0]
          nodePixels[index + 1] = pixel[1]
          nodePixels[index + 2] = pixel[2]
          nodePixels[index + 3] = Math.round(pixel[3] * alpha)
          present[outputY * options.width + outputX] = 1
        }
      }
      cached = { pixels: nodePixels, present }
      const elapsedMs = now() - startedAt
      if (cacheEnabled) {
        const cacheValue = options.canvasPool
          ? { pixels: nodePixels.slice(), present: present.slice() }
          : cached
        groupCache.recordMiss(cacheKey, elapsedMs, cacheValue)
      }
      options.canvasPool?.recordMiss(options.width, options.height, elapsedMs, {
        pixels: nodePixels,
        present
      })
    }
    // Cache only the source raster. Effects stay outside the cache so blur or
    // mask edits do not force source sampling across the full output surface.
    const { pixels: sourcePixels, present } = cached
    let nodePixels = sourcePixels
    for (const effect of options.effectFilters ?? []) {
      if (effect.enabled) {
        nodePixels = applyRasterEffect(nodePixels, present, options.width, options.height, effect)
      }
    }
    for (const stack of options.effectStacks ?? []) {
      if (!isWithinNodeOrDescendant(plan, node, stack.layerId)) continue
      for (const effect of stack.filters) {
        if (effect.enabled) {
          nodePixels = applyRasterEffect(
            nodePixels,
            present,
            options.width,
            options.height,
            effect,
            (x, y) => effectMaskContainsPixel(plan, stack, x, y)
          )
        }
      }
    }
    for (let outputY = 0; outputY < options.height; outputY += 1) {
      for (let outputX = 0; outputX < options.width; outputX += 1) {
        if (present[outputY * options.width + outputX] === 0) continue
        const index = (outputY * options.width + outputX) * 4
        blendOver(
          pixels,
          index,
          [
            nodePixels[index] ?? 0,
            nodePixels[index + 1] ?? 0,
            nodePixels[index + 2] ?? 0,
            nodePixels[index + 3] ?? 0
          ],
          node.inheritedOpacity
        )
      }
    }
    if (scratch) {
      options.canvasPool?.release(options.width, options.height, scratch)
    }
  }
  const backend = options.backend ?? 'canvas2d'
  const backendCapability = capability(
    backend,
    gaps.length > 0 ? 'UNKNOWN' : 'SUPPORTED',
    backend === 'canvas2d' ? 'NON_EQUIVALENT' : 'UNKNOWN',
    gaps,
    options.parity
  )
  validateRasterBackendCapability(backendCapability)
  return {
    status: 'SUPPORTED',
    format: 'rgba8-srgb',
    backend,
    capability: backendCapability,
    width: options.width,
    height: options.height,
    pixels,
    gaps
  }
}

export function composeRaster(
  plan: CompositionPlan,
  resolve: RasterCompositionAssetResolver,
  options: RasterCompositionOptions
): RasterCompositionResult {
  if (options.backend === 'skia') {
    const gaps: RasterUnsupportedGap[] = [
      { code: 'skia-oracle-unavailable', message: 'Skia raster oracle is unavailable' }
    ]
    const backendCapability = capability('skia', 'UNSUPPORTED', 'UNKNOWN', gaps, options.parity)
    validateRasterBackendCapability(backendCapability)
    return {
      status: 'UNSUPPORTED',
      format: 'rgba8-srgb',
      backend: 'skia',
      capability: backendCapability,
      gaps
    }
  }
  if (options.backend === 'webgl2' || options.backend === 'webgpu') {
    const gaps: RasterUnsupportedGap[] = [
      { code: 'backend-unavailable', message: `${options.backend} raster oracle is unavailable` }
    ]
    const backendCapability = capability(
      options.backend,
      'UNSUPPORTED',
      'UNKNOWN',
      gaps,
      options.parity
    )
    validateRasterBackendCapability(backendCapability)
    return {
      status: 'UNSUPPORTED',
      format: 'rgba8-srgb',
      backend: options.backend,
      capability: backendCapability,
      gaps
    }
  }
  return composeRasterRGBA8(plan, resolve, options)
}
