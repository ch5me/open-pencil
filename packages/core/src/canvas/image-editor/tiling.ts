import type { ImageDirtyRect } from "./types";

export interface ImageTile {
  readonly column: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ImageTilePlan {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly tileSize: number;
  readonly mipmapLevel: number;
  readonly scale: number;
  readonly proxy: boolean;
  readonly tiles: readonly ImageTile[];
}

export interface ImageTilePlanOptions {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly tileSize?: number;
  readonly dirtyRect?: ImageDirtyRect;
  readonly scale?: number;
  readonly proxyMaxDimension?: number;
}

const DEFAULT_TILE_SIZE = 256;

export function createImageTilePlan(options: ImageTilePlanOptions): ImageTilePlan {
  const sourceWidth = positiveFinite(options.sourceWidth, "source width");
  const sourceHeight = positiveFinite(options.sourceHeight, "source height");
  const tileSize = positiveInteger(options.tileSize ?? DEFAULT_TILE_SIZE, "tile size");
  const requestedScale = positiveFinite(options.scale ?? 1, "scale");
  const proxyMaxDimension =
    options.proxyMaxDimension === undefined
      ? undefined
      : positiveFinite(options.proxyMaxDimension, "proxy max dimension");
  const scale = proxyMaxDimension
    ? chooseProxyScale(sourceWidth, sourceHeight, requestedScale, proxyMaxDimension)
    : requestedScale;
  const dirtyRect = options.dirtyRect
    ? intersectDirtyRect(options.dirtyRect, sourceWidth, sourceHeight)
    : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  const tiles: ImageTile[] = [];

  if (dirtyRect.width > 0 && dirtyRect.height > 0) {
    const firstColumn = Math.floor(dirtyRect.x / tileSize);
    const lastColumn = Math.ceil((dirtyRect.x + dirtyRect.width) / tileSize) - 1;
    const firstRow = Math.floor(dirtyRect.y / tileSize);
    const lastRow = Math.ceil((dirtyRect.y + dirtyRect.height) / tileSize) - 1;
    const columns = Math.ceil(sourceWidth / tileSize);
    const rows = Math.ceil(sourceHeight / tileSize);

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
        const x = column * tileSize;
        const y = row * tileSize;
        tiles.push({
          column,
          row,
          x,
          y,
          width: Math.min(tileSize, sourceWidth - x),
          height: Math.min(tileSize, sourceHeight - y),
        });
      }
    }
  }

  return {
    sourceWidth,
    sourceHeight,
    tileSize,
    mipmapLevel: mipmapLevelForScale(scale),
    scale,
    proxy: scale < 1,
    tiles,
  };
}

export function chooseProxyScale(
  sourceWidth: number,
  sourceHeight: number,
  requestedScale: number,
  maxDimension: number,
): number {
  const width = positiveFinite(sourceWidth, "source width");
  const height = positiveFinite(sourceHeight, "source height");
  const scale = positiveFinite(requestedScale, "scale");
  const max = positiveFinite(maxDimension, "proxy max dimension");
  return Math.min(scale, max / Math.max(width, height));
}

export function mipmapLevelForScale(scale: number): number {
  const value = positiveFinite(scale, "scale");
  return Math.max(0, Math.ceil(Math.log2(1 / value)));
}

function intersectDirtyRect(rect: ImageDirtyRect, width: number, height: number): ImageDirtyRect {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new RangeError("invalid image dirty rectangle");
  }
  const x = Math.max(0, Math.min(width, rect.x));
  const y = Math.max(0, Math.min(height, rect.y));
  const right = Math.max(x, Math.min(width, rect.x + rect.width));
  const bottom = Math.max(y, Math.min(height, rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`invalid ${label}`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`invalid ${label}`);
  return value;
}
