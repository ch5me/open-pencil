import type { CompositionNode, CompositionPlan } from "#core/canvas/composition";
import type { AssetId, AssetRevision } from "#core/editor/assets";

export type RasterPixelFormat = "rgba8-srgb" | "rgba16f-linear-premultiplied";

export type RasterUnsupportedGapCode =
  | "rgba16f-unavailable"
  | "skia-oracle-unavailable"
  | "malformed-rgba8";

export interface RasterUnsupportedGap {
  readonly code: RasterUnsupportedGapCode;
  readonly message: string;
  readonly assetId?: AssetId;
}

export interface RasterCompositionUnsupported {
  readonly status: "UNSUPPORTED";
  readonly format: RasterPixelFormat;
  readonly gaps: readonly RasterUnsupportedGap[];
  readonly pixels?: never;
}

export interface RasterCompositionPixels {
  readonly status: "SUPPORTED";
  readonly format: "rgba8-srgb";
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly gaps: readonly RasterUnsupportedGap[];
}

export type RasterCompositionResult = RasterCompositionPixels | RasterCompositionUnsupported;

export interface RasterCompositionAssetResolver {
  getAsset(assetId: AssetId): { assetId: AssetId; revisionId: string } | undefined;
  getRevision(revisionId: string): AssetRevision | undefined;
}

export type RasterAdjustment = (
  pixel: readonly [number, number, number, number],
  node: CompositionNode,
) => readonly [number, number, number, number];

export interface RasterCompositionOptions {
  readonly width: number;
  readonly height: number;
  readonly adjustments?: Readonly<Record<string, RasterAdjustment>>;
  readonly backend?: "cpu-rgba8" | "skia";
}

export class RasterCompositionError extends Error {
  readonly code = "E_RASTER_COMPOSITION";
}

function numberMetadata(revision: AssetRevision, key: string): number | undefined {
  const value = revision.metadata[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function formatMetadata(revision: AssetRevision): RasterPixelFormat {
  return revision.metadata.format === "rgba16f-linear-premultiplied"
    ? "rgba16f-linear-premultiplied"
    : "rgba8-srgb";
}

function blendOver(
  output: Uint8Array,
  outputIndex: number,
  source: readonly [number, number, number, number],
  opacity: number,
): void {
  const sourceAlpha = (source[3] / 255) * opacity;
  if (sourceAlpha <= 0) return;
  const destinationAlpha = (output[outputIndex + 3] ?? 0) / 255;
  const resultAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (resultAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const sourceColor = source[channel] / 255;
    const destinationColor = (output[outputIndex + channel] ?? 0) / 255;
    const result = (sourceColor * sourceAlpha + destinationColor * destinationAlpha * (1 - sourceAlpha)) / resultAlpha;
    output[outputIndex + channel] = Math.round(result * 255);
  }
  output[outputIndex + 3] = Math.round(resultAlpha * 255);
}

function pointInRotatedNode(
  node: CompositionNode,
  x: number,
  y: number,
): { x: number; y: number } | undefined {
  const { x: originX, y: originY, width, height } = node.bounds;
  if (width <= 0 || height <= 0) return undefined;
  const radians = (-node.rotation * Math.PI) / 180;
  const centerX = originX + width / 2;
  const centerY = originY + height / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians) + width / 2;
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians) + height / 2;
  if (localX < 0 || localY < 0 || localX >= width || localY >= height) return undefined;
  return { x: localX, y: localY };
}

function withinClips(plan: CompositionPlan, node: CompositionNode, x: number, y: number): boolean {
  let parentId = node.parentId;
  while (parentId) {
    const parent = plan.nodes.get(parentId);
    if (!parent) break;
    if (parent.clipsContent && !pointInRotatedNode(parent, x, y)) return false;
    parentId = parent.parentId;
  }
  return true;
}

function maskAlpha(plan: CompositionPlan, node: CompositionNode, x: number, y: number): number {
  let parentId = node.parentId;
  while (parentId) {
    const parent = plan.nodes.get(parentId);
    if (!parent) break;
    if (parent.maskType && !pointInRotatedNode(parent, x, y)) return 0;
    const childIndex = parent.childIds.indexOf(node.nodeId);
    if (childIndex > 0) {
      let maskIndex = childIndex - 1;
      const siblingMasks: CompositionNode[] = [];
      while (maskIndex >= 0) {
        const siblingId = parent.childIds[maskIndex];
        const sibling = siblingId ? plan.nodes.get(siblingId) : undefined;
        if (!sibling?.visible || !sibling.maskType) break;
        siblingMasks.push(sibling);
        maskIndex -= 1;
      }
      if (siblingMasks.length > 0 && siblingMasks.some((mask) => !pointInRotatedNode(mask, x, y))) {
        return 0;
      }
    }
    if (childIndex < 0) break;
    node = parent;
    parentId = parent.parentId;
  }
  return 1;
}

function sourcePixel(
  bytes: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const sourceX = Math.min(width - 1, Math.max(0, Math.floor(x)));
  const sourceY = Math.min(height - 1, Math.max(0, Math.floor(y)));
  const index = (sourceY * width + sourceX) * 4;
  return [bytes[index] ?? 0, bytes[index + 1] ?? 0, bytes[index + 2] ?? 0, bytes[index + 3] ?? 0];
}

export function composeRasterRGBA8(
  plan: CompositionPlan,
  resolve: RasterCompositionAssetResolver,
  options: RasterCompositionOptions,
): RasterCompositionPixels {
  if (!Number.isInteger(options.width) || !Number.isInteger(options.height) || options.width <= 0 || options.height <= 0) {
    throw new RasterCompositionError("invalid RGBA8 output dimensions");
  }
  const pixels = new Uint8Array(options.width * options.height * 4);
  const gaps: RasterUnsupportedGap[] = [];
  for (const node of plan.nodes.values()) {
    if (!node.visible || node.maskType || node.assetIds.length === 0) continue;
    const assetId = node.assetIds[0];
    if (!assetId) continue;
    const binding = resolve.getAsset(assetId);
    const revision = binding && resolve.getRevision(binding.revisionId);
    if (!binding || !revision) continue;
    const format = formatMetadata(revision);
    if (format !== "rgba8-srgb") {
      gaps.push({ code: "rgba16f-unavailable", message: "RGBA16F composition is unavailable", assetId });
      continue;
    }
    const sourceWidth = numberMetadata(revision, "width");
    const sourceHeight = numberMetadata(revision, "height");
    if (!sourceWidth || !sourceHeight || revision.bytes.byteLength !== sourceWidth * sourceHeight * 4) {
      gaps.push({ code: "malformed-rgba8", message: "RGBA8 asset metadata or byte length is invalid", assetId });
      continue;
    }
    const { width, height } = node.bounds;
    for (let outputY = 0; outputY < options.height; outputY += 1) {
      for (let outputX = 0; outputX < options.width; outputX += 1) {
        const local = pointInRotatedNode(node, outputX + 0.5, outputY + 0.5);
        if (!local || !withinClips(plan, node, outputX + 0.5, outputY + 0.5)) continue;
        const alpha = maskAlpha(plan, node, outputX + 0.5, outputY + 0.5);
        if (alpha === 0) continue;
        let pixel = sourcePixel(revision.bytes, sourceWidth, sourceHeight, (local.x / width) * sourceWidth, (local.y / height) * sourceHeight);
        for (const hook of node.adjustmentHooks) {
          const adjustment = options.adjustments?.[hook];
          if (adjustment) pixel = adjustment(pixel, node);
        }
        const adjusted: readonly [number, number, number, number] = [pixel[0], pixel[1], pixel[2], Math.round(pixel[3] * alpha)];
        blendOver(pixels, (outputY * options.width + outputX) * 4, adjusted, node.inheritedOpacity);
      }
    }
  }
  return { status: "SUPPORTED", format: "rgba8-srgb", width: options.width, height: options.height, pixels, gaps };
}

export function composeRaster(
  plan: CompositionPlan,
  resolve: RasterCompositionAssetResolver,
  options: RasterCompositionOptions,
): RasterCompositionResult {
  if (options.backend === "skia") {
    return {
      status: "UNSUPPORTED",
      format: "rgba8-srgb",
      gaps: [{ code: "skia-oracle-unavailable", message: "Skia raster oracle is unavailable" }],
    };
  }
  return composeRasterRGBA8(plan, resolve, options);
}
