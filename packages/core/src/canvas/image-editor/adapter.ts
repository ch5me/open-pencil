import type { CompositionPlan } from '#core/canvas/composition'
import type { AssetId } from '#core/editor/assets'

import { createImageTilePlan } from './tiling'
import {
  ImageRenderContextLostError,
  UnsupportedImageBackendError,
  type ImageRenderAdapter,
  type ImageRenderCommand,
  type ImageRenderFrame,
  type ImageRenderGap,
  type ImageDirtyRect,
  type ImageRevisionResolver,
  type ImageTexture
} from './types'

export interface ImageRenderAdapterOptions {
  readonly backend?: string
  readonly tileSize?: number
  readonly proxyMaxDimension?: number
  readonly maxTextureBytes?: number
  readonly maxTiles?: number
}

export function createImageRenderAdapter(
  options: ImageRenderAdapterOptions = {}
): ImageRenderAdapter {
  if (options.backend !== undefined && options.backend !== 'skia') {
    throw new UnsupportedImageBackendError(`unsupported image backend: ${options.backend}`)
  }
  const dirtyAssets = new Set<AssetId>()
  const dirtyRects = new Map<AssetId, ImageDirtyRect>()
  const uploadedRevisions = new Map<AssetId, string>()
  let contextLost = false
  let resourceGeneration = 0

  return {
    backend: 'skia',
    get resourceGeneration(): number {
      return resourceGeneration
    },
    render(plan: CompositionPlan, resolve: ImageRevisionResolver): ImageRenderFrame {
      if (contextLost) {
        throw new ImageRenderContextLostError(
          'image render context is lost; wait for resource restoration'
        )
      }
      const nextDirtyAssets = new Set(dirtyAssets)
      const nextDirtyRects = new Map(dirtyRects)
      const nextUploadedRevisions = new Map(uploadedRevisions)
      const commands: ImageRenderCommand[] = []
      const textures: ImageTexture[] = []
      const gaps: ImageRenderGap[] = []
      const emittedAssets = new Set<AssetId>()
      for (const entry of plan.nodes.values()) {
        if (!entry.visible) continue
        const assetId = entry.assetIds[0] ?? null
        commands.push({
          nodeId: entry.nodeId,
          assetId,
          opacity: entry.inheritedOpacity,
          blendMode: entry.blendMode,
          clipped: entry.clipsContent,
          rotation: entry.rotation,
          maskType: entry.maskType,
          maskIsOutline: entry.maskIsOutline,
          adjustmentHooks: entry.adjustmentHooks
        })
        if (assetId) {
          const binding = resolve.getAsset(assetId)
          if (!binding) {
            gaps.push({
              code: 'missing-asset-binding',
              message: `asset binding is unavailable: ${assetId}`,
              assetId
            })
            continue
          }
          if (binding.assetId !== assetId) {
            gaps.push({
              code: 'asset-binding-mismatch',
              message: `asset binding does not match requested asset: ${assetId}`,
              assetId
            })
            continue
          }
          const revision = resolve.getRevision(binding.revisionId)
          if (!revision) {
            gaps.push({
              code: 'missing-asset-revision',
              message: `asset revision is unavailable: ${binding.revisionId}`,
              assetId
            })
            continue
          }
          if (revision.revisionId !== binding.revisionId) {
            gaps.push({
              code: 'asset-revision-mismatch',
              message: `asset revision does not match requested revision: ${binding.revisionId}`,
              assetId
            })
            continue
          }
          if (!(revision.bytes instanceof Uint8Array) || revision.bytes.byteLength === 0) {
            gaps.push({
              code: 'corrupted-image',
              message: `image revision is corrupted: ${binding.revisionId}`,
              assetId
            })
            continue
          }
          if (emittedAssets.has(assetId)) continue
          emittedAssets.add(assetId)
          const dirty =
            nextDirtyAssets.has(assetId) ||
            nextUploadedRevisions.get(assetId) !== binding.revisionId
          if (!dirty) {
            textures.push({
              assetId,
              revisionId: binding.revisionId,
              byteLength: revision.bytes.byteLength,
              dirty: false,
              uploaded: false
            })
          } else {
            const revisionChanged = nextUploadedRevisions.get(assetId) !== binding.revisionId
            const dirtyRect = nextDirtyRects.get(assetId)
            let tilePlan: Pick<ImageTexture, 'tilePlan'>
            try {
              tilePlan = createTextureTilePlan(revision.metadata, dirtyRect, options)
            } catch (error) {
              if (!(error instanceof RangeError)) throw error
              gaps.push({
                code: 'corrupted-image',
                message: `image metadata is corrupted: ${binding.revisionId}`,
                assetId
              })
              continue
            }
            nextUploadedRevisions.set(assetId, binding.revisionId)
            nextDirtyAssets.delete(assetId)
            nextDirtyRects.delete(assetId)
            textures.push({
              assetId,
              revisionId: binding.revisionId,
              byteLength: revision.bytes.byteLength,
              dirty: true,
              uploaded: true,
              ...tilePlan,
              ...(dirtyRect && !revisionChanged
                ? { update: { kind: 'partial' as const, dirtyRect } }
                : {})
            })
          }
        }
      }
      replaceSet(dirtyAssets, nextDirtyAssets)
      replaceMap(dirtyRects, nextDirtyRects)
      replaceMap(uploadedRevisions, nextUploadedRevisions)
      return { backend: 'skia', commands, textures, gaps }
    },
    markDirty(assetId: AssetId, dirtyRect?: ImageDirtyRect): void {
      if (dirtyRect) {
        validateDirtyRect(dirtyRect)
        const previous = dirtyRects.get(assetId)
        dirtyRects.set(assetId, previous ? unionDirtyRects(previous, dirtyRect) : { ...dirtyRect })
      }
      dirtyAssets.add(assetId)
    },
    loseContext(): void {
      contextLost = true
      dirtyAssets.clear()
      dirtyRects.clear()
      uploadedRevisions.clear()
    },
    restore(): void {
      contextLost = false
      resourceGeneration += 1
      dirtyAssets.clear()
      dirtyRects.clear()
      uploadedRevisions.clear()
    }
  }
}

function replaceSet<T>(target: Set<T>, source: ReadonlySet<T>): void {
  target.clear()
  for (const value of source) target.add(value)
}

function replaceMap<K, V>(target: Map<K, V>, source: ReadonlyMap<K, V>): void {
  target.clear()
  for (const [key, value] of source) target.set(key, value)
}

function createTextureTilePlan(
  metadata: Readonly<Record<string, unknown>>,
  dirtyRect: ImageDirtyRect | undefined,
  options: ImageRenderAdapterOptions
): Pick<ImageTexture, 'tilePlan'> {
  const width = metadata.width
  const height = metadata.height
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    (width as number) <= 0 ||
    (height as number) <= 0
  ) {
    return {}
  }
  return {
    tilePlan: createImageTilePlan({
      sourceWidth: width as number,
      sourceHeight: height as number,
      ...(dirtyRect ? { dirtyRect } : {}),
      ...(options.tileSize === undefined ? {} : { tileSize: options.tileSize }),
      ...(options.proxyMaxDimension === undefined
        ? {}
        : { proxyMaxDimension: options.proxyMaxDimension }),
      ...(options.maxTextureBytes === undefined
        ? {}
        : { maxTextureBytes: options.maxTextureBytes }),
      ...(options.maxTiles === undefined ? {} : { maxTiles: options.maxTiles })
    })
  }
}

function validateDirtyRect(rect: ImageDirtyRect): void {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new RangeError('invalid image texture dirty rectangle')
  }
}

function unionDirtyRects(left: ImageDirtyRect, right: ImageDirtyRect): ImageDirtyRect {
  const x = Math.min(left.x, right.x)
  const y = Math.min(left.y, right.y)
  const rightEdge = Math.max(left.x + left.width, right.x + right.width)
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height)
  return { x, y, width: rightEdge - x, height: bottomEdge - y }
}
