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

export function createImageSelection(
  mode: ImageSelectionMode,
  points: readonly { x: number; y: number }[],
  transactionId: `tx:${string}`,
): ImageSelection {
  return { mode, points: points.map((point) => ({ ...point })), transactionId };
}

export function selectMask(mask: RasterMask): MaskSelection {
  return { selectedMaskId: mask.maskId, selectedThumbnailId: mask.thumbnailId };
}

export function clearMaskSelection(): MaskSelection {
  return { selectedMaskId: null, selectedThumbnailId: null };
}
