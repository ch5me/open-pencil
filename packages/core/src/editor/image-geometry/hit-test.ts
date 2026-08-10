import { mapInverse } from "./transform";
import type {
  GeometryTransform,
  HitTestOptions,
  RasterLayer,
  RasterPixelSource,
  Vector,
} from "./types";

export function pointInTransformedRect(
  transform: GeometryTransform,
  point: Vector,
  options: HitTestOptions = {},
): boolean {
  const local = mapInverse(transform, point);
  const tolerance = options.tolerance ?? 0;
  return (
    local.x >= -tolerance &&
    local.y >= -tolerance &&
    local.x <= transform.width + tolerance &&
    local.y <= transform.height + tolerance
  );
}

function validateSource(source: RasterPixelSource): void {
  if (
    !Number.isInteger(source.width) ||
    !Number.isInteger(source.height) ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    throw new RangeError("raster dimensions must be positive integers");
  }
  if (source.pixels.length < source.width * source.height * 4) {
    throw new RangeError("raster pixel buffer is too short");
  }
}

function alphaThreshold(options: HitTestOptions): number {
  const threshold = options.alphaThreshold ?? 1;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
    throw new RangeError("alpha threshold must be between 0 and 255");
  }
  return threshold;
}

/**
 * Hit-tests the rendered alpha of a raster layer, not just its transformed box.
 * Layers use bottom-to-top ordering; see selectLayerAtPoint.
 */
export function hitTestPixel(
  transform: GeometryTransform,
  source: RasterPixelSource,
  point: Vector,
  options: HitTestOptions = {},
): boolean {
  validateSource(source);
  const tolerance = options.tolerance ?? 0;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError("hit-test tolerance must be non-negative");
  }
  const threshold = alphaThreshold(options);
  const local = mapInverse(transform, point);
  if (transform.width === 0 || transform.height === 0) return false;
  if (
    local.x < -tolerance ||
    local.y < -tolerance ||
    local.x > transform.width + tolerance ||
    local.y > transform.height + tolerance
  ) {
    return false;
  }
  const x = Math.min(
    source.width - 1,
    Math.max(0, Math.floor((Math.max(0, local.x) / transform.width) * source.width)),
  );
  const y = Math.min(
    source.height - 1,
    Math.max(0, Math.floor((Math.max(0, local.y) / transform.height) * source.height)),
  );
  const alpha = source.pixels[(y * source.width + x) * 4 + 3];
  return typeof alpha === "number" && alpha >= threshold;
}

export function hitTestRasterLayer(
  layer: RasterLayer,
  point: Vector,
  options: HitTestOptions = {},
): boolean {
  return (
    layer.visible !== false &&
    layer.locked !== true &&
    hitTestPixel(layer.transform, layer.source, point, options)
  );
}

export function selectLayerAtPoint(
  layers: readonly RasterLayer[],
  point: Vector,
  options: HitTestOptions = {},
): RasterLayer | null {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (layer && hitTestRasterLayer(layer, point, options)) return layer;
  }
  return null;
}
