import type { RasterMask } from "#core/editor/image-raster";

export interface MaskSelection {
  readonly selectedMaskId: string | null;
  readonly selectedThumbnailId: string | null;
}

export function selectMask(mask: RasterMask): MaskSelection {
  return { selectedMaskId: mask.maskId, selectedThumbnailId: mask.thumbnailId };
}

export function clearMaskSelection(): MaskSelection {
  return { selectedMaskId: null, selectedThumbnailId: null };
}
