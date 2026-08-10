import type { CompositionNode, CompositionPlan } from "#core/canvas/composition";
import type { AssetId, AssetRevision } from "#core/editor/assets";
import {
  createRasterEffectAdjustment,
  isAdjustmentLayerKind,
  validateEffectStack,
  validateEffectFilter,
  type AdjustmentLayerKind,
  type EffectFilter,
  type EffectKind,
  type EffectStack,
} from "#core/editor/image-capabilities/effects";

export type RasterPixelFormat = "rgba8-srgb" | "rgba16f-linear-premultiplied";

export type RasterBackend = "canvas2d" | "webgl2" | "webgpu" | "skia";
export type RasterCapabilityState = "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";

export interface RasterParityThresholds {
  readonly maxChannelDelta: number;
  readonly maxMeanBias: number;
}

export interface RasterBackendCapability {
  readonly version: "raster-backend-capability-v1";
  readonly backend: RasterBackend;
  readonly format: RasterPixelFormat;
  readonly state: RasterCapabilityState;
  readonly equivalence: "PARITY_PROVEN" | "NON_EQUIVALENT" | "UNKNOWN";
  readonly parity: RasterParityThresholds;
  readonly gaps: readonly RasterUnsupportedGap[];
}

export type RasterUnsupportedGapCode =
  | "rgba16f-unavailable"
  | "skia-oracle-unavailable"
  | "backend-unavailable"
  | "malformed-rgba8";

export interface RasterUnsupportedGap {
  readonly code: RasterUnsupportedGapCode;
  readonly message: string;
  readonly assetId?: AssetId;
}

export interface RasterCompositionUnsupported {
  readonly status: "UNSUPPORTED";
  readonly format: RasterPixelFormat;
  readonly backend: RasterBackend;
  readonly capability: RasterBackendCapability;
  readonly gaps: readonly RasterUnsupportedGap[];
  readonly pixels?: never;
}

export interface RasterCompositionPixels {
  readonly status: "SUPPORTED";
  readonly format: "rgba8-srgb";
  readonly backend: RasterBackend;
  readonly capability: RasterBackendCapability;
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
  readonly adjustmentLayerAdjustments?: Readonly<Partial<Record<AdjustmentLayerKind, RasterAdjustment>>>;
  /**
   * Typed effect filters consumed by the CPU reference when no host callback
   * is supplied. Areas are expressed in output pixels.
   */
  readonly effectFilters?: readonly EffectFilter[];
  /**
   * Layer- or group-scoped, ordered effect stacks. Smart stacks remain
   * non-destructive: the source pixels are read again for every composition.
   */
  readonly effectStacks?: readonly EffectStack[];
  readonly backend?: RasterBackend;
  readonly parity?: Partial<RasterParityThresholds>;
}

export class RasterCompositionError extends Error {
  readonly code: string = "E_RASTER_COMPOSITION";
}

export class RasterBackendUnavailableError extends RasterCompositionError {
  readonly code = "E_RASTER_BACKEND_UNAVAILABLE";
}

export const RASTER_RGBA8_PARITY: RasterParityThresholds = {
  maxChannelDelta: 1 / 255,
  maxMeanBias: 1 / 255,
};

function capability(
  backend: RasterBackend,
  state: RasterCapabilityState,
  equivalence: RasterBackendCapability["equivalence"],
  gaps: readonly RasterUnsupportedGap[],
  parity: Partial<RasterParityThresholds> = {},
): RasterBackendCapability {
  return {
    version: "raster-backend-capability-v1",
    backend,
    format: "rgba8-srgb",
    state,
    equivalence,
    parity: { ...RASTER_RGBA8_PARITY, ...parity },
    gaps,
  };
}

export function validateRasterBackendCapability(capability: RasterBackendCapability): void {
  if (
    capability.version !== "raster-backend-capability-v1" ||
    !["canvas2d", "webgl2", "webgpu", "skia"].includes(capability.backend) ||
    !["rgba8-srgb", "rgba16f-linear-premultiplied"].includes(capability.format) ||
    !["SUPPORTED", "UNKNOWN", "UNSUPPORTED"].includes(capability.state) ||
    !["PARITY_PROVEN", "NON_EQUIVALENT", "UNKNOWN"].includes(capability.equivalence) ||
    !Number.isFinite(capability.parity.maxChannelDelta) ||
    !Number.isFinite(capability.parity.maxMeanBias)
  ) {
    throw new RasterCompositionError("invalid raster backend capability");
  }
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

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
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
    const sourceColor = srgbToLinear(source[channel] / 255);
    const destinationColor = srgbToLinear((output[outputIndex + channel] ?? 0) / 255);
    const result =
      (sourceColor * sourceAlpha +
        destinationColor * destinationAlpha * (1 - sourceAlpha)) /
      resultAlpha;
    output[outputIndex + channel] = Math.round(linearToSrgb(result) * 255);
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

function effectContainsPixel(effect: EffectFilter, x: number, y: number): boolean {
  const [effectX, effectY, width, height] = effect.affectedArea;
  return x >= effectX && x < effectX + width && y >= effectY && y < effectY + height;
}

function isWithinNodeOrDescendant(plan: CompositionPlan, node: CompositionNode, ancestorId: string): boolean {
  let current: CompositionNode | undefined = node;
  while (current) {
    if (current.nodeId === ancestorId) return true;
    current = current.parentId ? plan.nodes.get(current.parentId) : undefined;
  }
  return false;
}

function effectMaskContainsPixel(
  plan: CompositionPlan,
  stack: EffectStack,
  x: number,
  y: number,
): boolean {
  if (stack.effectMaskIds.length === 0) return true;
  return stack.effectMaskIds.every((maskId) => {
    const mask = plan.nodes.get(maskId);
    return mask !== undefined && pointInRotatedNode(mask, x + 0.5, y + 0.5) !== undefined;
  });
}

function validateEffectArea(effect: EffectFilter, width: number, height: number): void {
  const [x, y, areaWidth, areaHeight] = effect.affectedArea;
  if (
    x + areaWidth > width ||
    y + areaHeight > height ||
    (areaWidth * areaHeight) / (width * height) > 0.25
  ) {
    throw new RasterCompositionError("effect area exceeds bounded pixel contract");
  }
}

export function composeRasterRGBA8(
  plan: CompositionPlan,
  resolve: RasterCompositionAssetResolver,
  options: RasterCompositionOptions,
): RasterCompositionPixels {
  if (options.backend !== undefined && options.backend !== "canvas2d") {
    throw new RasterBackendUnavailableError(
      `RGBA8 compositor cannot claim ${options.backend} backend support`,
    );
  }
  if (!Number.isInteger(options.width) || !Number.isInteger(options.height) || options.width <= 0 || options.height <= 0) {
    throw new RasterCompositionError("invalid RGBA8 output dimensions");
  }
  for (const effect of options.effectFilters ?? []) {
    validateEffectFilter(effect);
    validateEffectArea(effect, options.width, options.height);
  }
  for (const stack of options.effectStacks ?? []) {
    validateEffectStack(stack);
    for (const effect of stack.filters) validateEffectArea(effect, options.width, options.height);
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
          const effectKind = hook as EffectKind;
          const adjustment =
            options.adjustments?.[hook] ??
            (isAdjustmentLayerKind(effectKind)
              ? options.adjustmentLayerAdjustments?.[effectKind]
              : undefined);
          if (adjustment) pixel = adjustment(pixel, node);
        }
        for (const effect of options.effectFilters ?? []) {
          if (!effect.enabled || !effectContainsPixel(effect, outputX, outputY)) continue;
          pixel = createRasterEffectAdjustment(effect.kind, effect.adjustments)(pixel);
        }
        for (const stack of options.effectStacks ?? []) {
          if (
            !isWithinNodeOrDescendant(plan, node, stack.layerId) ||
            !effectMaskContainsPixel(plan, stack, outputX, outputY)
          ) {
            continue;
          }
          for (const effect of stack.filters) {
            if (!effect.enabled || !effectContainsPixel(effect, outputX, outputY)) continue;
            pixel = createRasterEffectAdjustment(effect.kind, effect.adjustments)(pixel);
          }
        }
        const adjusted: readonly [number, number, number, number] = [pixel[0], pixel[1], pixel[2], Math.round(pixel[3] * alpha)];
        blendOver(pixels, (outputY * options.width + outputX) * 4, adjusted, node.inheritedOpacity);
      }
    }
  }
  const backend = options.backend ?? "canvas2d";
  const backendCapability = capability(
    backend,
    gaps.length > 0 ? "UNKNOWN" : "SUPPORTED",
    backend === "canvas2d" ? "NON_EQUIVALENT" : "UNKNOWN",
    gaps,
    options.parity,
  );
  validateRasterBackendCapability(backendCapability);
  return {
    status: "SUPPORTED",
    format: "rgba8-srgb",
    backend,
    capability: backendCapability,
    width: options.width,
    height: options.height,
    pixels,
    gaps,
  };
}

export function composeRaster(
  plan: CompositionPlan,
  resolve: RasterCompositionAssetResolver,
  options: RasterCompositionOptions,
): RasterCompositionResult {
  if (options.backend === "skia") {
    const gaps: RasterUnsupportedGap[] = [
      { code: "skia-oracle-unavailable", message: "Skia raster oracle is unavailable" },
    ];
    const backendCapability = capability("skia", "UNSUPPORTED", "UNKNOWN", gaps, options.parity);
    validateRasterBackendCapability(backendCapability);
    return {
      status: "UNSUPPORTED",
      format: "rgba8-srgb",
      backend: "skia",
      capability: backendCapability,
      gaps,
    };
  }
  if (options.backend === "webgl2" || options.backend === "webgpu") {
    const gaps: RasterUnsupportedGap[] = [
      { code: "backend-unavailable", message: `${options.backend} raster oracle is unavailable` },
    ];
    const backendCapability = capability(options.backend, "UNSUPPORTED", "UNKNOWN", gaps, options.parity);
    validateRasterBackendCapability(backendCapability);
    return {
      status: "UNSUPPORTED",
      format: "rgba8-srgb",
      backend: options.backend,
      capability: backendCapability,
      gaps,
    };
  }
  return composeRasterRGBA8(plan, resolve, options);
}
