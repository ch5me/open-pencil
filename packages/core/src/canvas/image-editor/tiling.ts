import type { ImageDirtyRect } from './types'

export interface ImageTile {
  readonly column: number
  readonly row: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ImageTilePlan {
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly renderWidth: number
  readonly renderHeight: number
  readonly tileSize: number
  readonly mipmapLevel: number
  readonly scale: number
  readonly proxy: boolean
  readonly estimatedBytes: number
  readonly textureMemoryBudgetBytes: number | 'UNKNOWN'
  readonly adaptiveResolution: boolean
  readonly tiles: readonly ImageTile[]
}

export interface ImageTilePlanOptions {
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly tileSize?: number
  readonly dirtyRect?: ImageDirtyRect
  readonly scale?: number
  readonly proxyMaxDimension?: number
  readonly maxTextureBytes?: number
  readonly maxTiles?: number
}

const DEFAULT_TILE_SIZE = 256
const DEFAULT_MAX_TILES = 4096

export class ImageTilePlanLimitError extends Error {
  readonly code = 'E_IMAGE_TILE_PLAN_LIMIT'
  readonly name = 'ImageTilePlanLimitError'
}

export class ImageTextureMemoryBudgetError extends Error {
  readonly code = 'E_IMAGE_TEXTURE_MEMORY_BUDGET'
  readonly name = 'ImageTextureMemoryBudgetError'
}

export function createImageTilePlan(options: ImageTilePlanOptions): ImageTilePlan {
  const sourceWidth = positiveFinite(options.sourceWidth, 'source width')
  const sourceHeight = positiveFinite(options.sourceHeight, 'source height')
  const tileSize = positiveInteger(options.tileSize ?? DEFAULT_TILE_SIZE, 'tile size')
  const maxTiles = positiveInteger(options.maxTiles ?? DEFAULT_MAX_TILES, 'max tiles')
  const requestedScale = positiveFinite(options.scale ?? 1, 'scale')
  const proxyMaxDimension =
    options.proxyMaxDimension === undefined
      ? undefined
      : positiveFinite(options.proxyMaxDimension, 'proxy max dimension')
  const maxTextureBytes =
    options.maxTextureBytes === undefined
      ? undefined
      : positiveInteger(options.maxTextureBytes, 'max texture bytes')
  const proxyScale = proxyMaxDimension
    ? chooseProxyScale(sourceWidth, sourceHeight, requestedScale, proxyMaxDimension)
    : requestedScale
  const scale = maxTextureBytes
    ? chooseTextureScale(sourceWidth, sourceHeight, proxyScale, maxTextureBytes)
    : proxyScale
  const renderWidth = Math.max(1, Math.ceil(sourceWidth * scale))
  const renderHeight = Math.max(1, Math.ceil(sourceHeight * scale))
  const estimatedBytes = renderWidth * renderHeight * 4
  if (!Number.isSafeInteger(estimatedBytes)) {
    throw new ImageTextureMemoryBudgetError('image texture size exceeds safe integer range')
  }
  if (maxTextureBytes !== undefined && estimatedBytes > maxTextureBytes) {
    throw new ImageTextureMemoryBudgetError(
      `image texture exceeds budget: ${estimatedBytes} > ${maxTextureBytes}`
    )
  }
  const dirtyRect = options.dirtyRect
    ? scaleDirtyRect(
        intersectDirtyRect(options.dirtyRect, sourceWidth, sourceHeight),
        scale,
        renderWidth,
        renderHeight
      )
    : { x: 0, y: 0, width: renderWidth, height: renderHeight }
  const tiles = planTiles(dirtyRect, renderWidth, renderHeight, tileSize, maxTiles)

  return {
    sourceWidth,
    sourceHeight,
    renderWidth,
    renderHeight,
    tileSize,
    mipmapLevel: mipmapLevelForScale(scale),
    scale,
    proxy: scale < 1,
    estimatedBytes,
    textureMemoryBudgetBytes: maxTextureBytes ?? 'UNKNOWN',
    adaptiveResolution: maxTextureBytes !== undefined && scale < proxyScale,
    tiles
  }
}

function planTiles(
  dirtyRect: ImageDirtyRect,
  renderWidth: number,
  renderHeight: number,
  tileSize: number,
  maxTiles: number
): ImageTile[] {
  if (dirtyRect.width <= 0 || dirtyRect.height <= 0) return []
  const firstColumn = Math.floor(dirtyRect.x / tileSize)
  const lastColumn = Math.ceil((dirtyRect.x + dirtyRect.width) / tileSize) - 1
  const firstRow = Math.floor(dirtyRect.y / tileSize)
  const lastRow = Math.ceil((dirtyRect.y + dirtyRect.height) / tileSize) - 1
  const columns = Math.ceil(renderWidth / tileSize)
  const rows = Math.ceil(renderHeight / tileSize)
  const tileCount = Math.max(0, lastColumn - firstColumn + 1) * Math.max(0, lastRow - firstRow + 1)
  if (tileCount > maxTiles) {
    throw new ImageTilePlanLimitError(`image tile plan exceeds limit: ${tileCount} > ${maxTiles}`)
  }

  const tiles: ImageTile[] = []
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      if (column < 0 || row < 0 || column >= columns || row >= rows) continue
      const x = column * tileSize
      const y = row * tileSize
      tiles.push({
        column,
        row,
        x,
        y,
        width: Math.min(tileSize, renderWidth - x),
        height: Math.min(tileSize, renderHeight - y)
      })
    }
  }
  return tiles
}

export function chooseTextureScale(
  sourceWidth: number,
  sourceHeight: number,
  requestedScale: number,
  maxTextureBytes: number
): number {
  const width = positiveFinite(sourceWidth, 'source width')
  const height = positiveFinite(sourceHeight, 'source height')
  const scale = positiveFinite(requestedScale, 'scale')
  const maxBytes = positiveInteger(maxTextureBytes, 'max texture bytes')
  const maxDimension = Math.sqrt(maxBytes / 4)
  if (maxDimension < 1) {
    throw new ImageTextureMemoryBudgetError('max texture bytes must allow one RGBA pixel')
  }
  return chooseProxyScale(width, height, scale, maxDimension)
}

export function chooseProxyScale(
  sourceWidth: number,
  sourceHeight: number,
  requestedScale: number,
  maxDimension: number
): number {
  const width = positiveFinite(sourceWidth, 'source width')
  const height = positiveFinite(sourceHeight, 'source height')
  const scale = positiveFinite(requestedScale, 'scale')
  const max = positiveFinite(maxDimension, 'proxy max dimension')
  return Math.min(scale, max / Math.max(width, height))
}

export function mipmapLevelForScale(scale: number): number {
  const value = positiveFinite(scale, 'scale')
  return Math.max(0, Math.ceil(Math.log2(1 / value)))
}

function intersectDirtyRect(rect: ImageDirtyRect, width: number, height: number): ImageDirtyRect {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new RangeError('invalid image dirty rectangle')
  }
  const x = Math.max(0, Math.min(width, rect.x))
  const y = Math.max(0, Math.min(height, rect.y))
  const right = Math.max(x, Math.min(width, rect.x + rect.width))
  const bottom = Math.max(y, Math.min(height, rect.y + rect.height))
  return { x, y, width: right - x, height: bottom - y }
}

function scaleDirtyRect(
  rect: ImageDirtyRect,
  scale: number,
  width: number,
  height: number
): ImageDirtyRect {
  const x = Math.max(0, Math.min(width, Math.floor(rect.x * scale)))
  const y = Math.max(0, Math.min(height, Math.floor(rect.y * scale)))
  const right = Math.max(x, Math.min(width, Math.ceil((rect.x + rect.width) * scale)))
  const bottom = Math.max(y, Math.min(height, Math.ceil((rect.y + rect.height) * scale)))
  return { x, y, width: right - x, height: bottom - y }
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`invalid ${label}`)
  return value
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`invalid ${label}`)
  return value
}
