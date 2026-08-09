import type { RasterMask } from "#core/editor/image-raster";

export interface MaskSelection {
  readonly selectedMaskId: string | null;
  readonly selectedThumbnailId: string | null;
}

export type ImageSelectionMode =
  | "marquee"
  | "lasso"
  | "polygon"
  | "magic-wand"
  | "subject"
  | "background";

export interface ImageSelection {
  readonly mode: ImageSelectionMode;
  readonly points: readonly { x: number; y: number }[];
  readonly transactionId: `tx:${string}`;
}

function validatePoint(point: { x: number; y: number }): { x: number; y: number } {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("invalid image selection point");
  }
  return { x: point.x, y: point.y };
}

export function createImageSelection(
  mode: ImageSelectionMode,
  points: readonly { x: number; y: number }[],
  transactionId: `tx:${string}`,
): ImageSelection {
  if (!/^tx:.+/u.test(transactionId)) throw new RangeError("invalid image selection transaction");
  return { mode, points: points.map(validatePoint), transactionId };
}

export function selectMask(mask: RasterMask): MaskSelection {
  if (!mask.maskId || !mask.thumbnailId) throw new RangeError("invalid image mask");
  return { selectedMaskId: mask.maskId, selectedThumbnailId: mask.thumbnailId };
}

export function clearMaskSelection(): MaskSelection {
  return { selectedMaskId: null, selectedThumbnailId: null };
}
