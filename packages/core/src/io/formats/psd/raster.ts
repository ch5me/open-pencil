import {
  PsdHostileFileError,
  PsdUnsupportedError,
  type PsdRasterInput,
  type PsdRasterLayer,
  type PsdRasterMask,
} from "./types";

function assertRasterDimensions(raster: PsdRasterLayer, width: number, height: number): void {
  if (
    !Number.isSafeInteger(raster.width) ||
    !Number.isSafeInteger(raster.height) ||
    raster.width !== width ||
    raster.height !== height ||
    raster.pixels.byteLength !== width * height * 4
  ) {
    throw new PsdHostileFileError("PSD raster layer dimensions do not match document");
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

const PSD_SUPPORTED_BLEND_MODES = new Set(["NORMAL", "PASS_THROUGH", "MULTIPLY", "SCREEN", "OVERLAY"]);
const PSD_SUPPORTED_ADJUSTMENT_TYPES = new Set([
  "brightness",
  "contrast",
  "saturation",
  "levels",
  "curves",
  "exposure",
  "vibrance",
  "hsl",
  "color-balance",
  "black-white",
  "threshold",
  "posterize",
  "gradient-map",
  "selective-color",
]);

function blendChannel(mode: string | undefined, source: number, destination: number): number {
  switch (mode ?? "NORMAL") {
    case "NORMAL":
    case "PASS_THROUGH":
      return source;
    case "MULTIPLY":
      return source * destination;
    case "SCREEN":
      return 1 - (1 - source) * (1 - destination);
    case "OVERLAY":
      return destination <= 0.5
        ? 2 * source * destination
        : 1 - 2 * (1 - source) * (1 - destination);
    default:
      throw new PsdUnsupportedError(`unsupported PSD blend mode: ${mode}`);
  }
}

type Affine = readonly [number, number, number, number, number, number];

function assertTransform(transform: Affine | undefined): void {
  if (transform && transform.some((value) => !Number.isFinite(value))) {
    throw new PsdHostileFileError("PSD raster transform is invalid");
  }
}

function inverseMap(
  transform: Affine,
  x: number,
  y: number,
): { x: number; y: number } | undefined {
  const [a, b, c, d, e, f] = transform;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new PsdHostileFileError("PSD raster transform is not invertible");
  }
  const translatedX = x - e;
  const translatedY = y - f;
  return {
    x: (d * translatedX - c * translatedY) / determinant,
    y: (-b * translatedX + a * translatedY) / determinant,
  };
}

function rotationTransform(
  rotation: number | undefined,
  width: number,
  height: number,
): Affine | undefined {
  if (rotation === undefined || rotation === 0) return undefined;
  if (!Number.isFinite(rotation)) throw new PsdHostileFileError("PSD raster rotation is invalid");
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = width / 2;
  const centerY = height / 2;
  const transform: Affine = [
    cosine,
    sine,
    -sine,
    cosine,
    centerX - cosine * centerX + sine * centerY,
    centerY - sine * centerX - cosine * centerY,
  ];
  assertTransform(transform);
  return transform;
}

function sourcePoint(
  raster: Pick<PsdRasterLayer, "width" | "height" | "transform" | "rotation">,
  x: number,
  y: number,
): { x: number; y: number } | undefined {
  const transform = raster.transform ?? rotationTransform(raster.rotation, raster.width, raster.height);
  return transform ? inverseMap(transform, x, y) : { x, y };
}

function sample(
  raster: Pick<PsdRasterLayer, "width" | "height" | "pixels" | "transform" | "rotation">,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const point = sourcePoint(raster, x + 0.5, y + 0.5);
  if (!point) return [0, 0, 0, 0];
  const sourceX = Math.floor(point.x);
  const sourceY = Math.floor(point.y);
  if (sourceX < 0 || sourceY < 0 || sourceX >= raster.width || sourceY >= raster.height) {
    return [0, 0, 0, 0];
  }
  const offset = (sourceY * raster.width + sourceX) * 4;
  return [
    raster.pixels[offset] ?? 0,
    raster.pixels[offset + 1] ?? 0,
    raster.pixels[offset + 2] ?? 0,
    raster.pixels[offset + 3] ?? 0,
  ];
}

function maskAlpha(mask: PsdRasterMask | undefined, x: number, y: number): number {
  if (!mask) return 1;
  const [, , , alpha] = sample(mask, x, y);
  const value = alpha / 255;
  return mask.inverted ? 1 - value : value;
}

/**
 * Composite producer-rendered RGBA8 layers into the flattened PSD image.
 * Text and vector shapes arrive here already rasterized by the renderer.
 */
export function rasterizePsdLayers(input: PsdRasterInput): Uint8Array {
  if (
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width <= 0 ||
    input.height <= 0
  ) {
    throw new PsdHostileFileError("PSD raster dimensions are invalid");
  }

  const result = new Uint8Array(input.width * input.height * 4);
  for (const layer of input.layers) {
    if (!layer.raster || !layer.visible || layer.opacity <= 0) continue;
    if (layer.blendMode !== undefined && !PSD_SUPPORTED_BLEND_MODES.has(layer.blendMode)) {
      throw new PsdUnsupportedError(`unsupported PSD blend mode: ${layer.blendMode}`);
    }
    if (
      layer.adjustmentType !== undefined &&
      !PSD_SUPPORTED_ADJUSTMENT_TYPES.has(layer.adjustmentType)
    ) {
      throw new PsdUnsupportedError(`unsupported PSD adjustment type: ${layer.adjustmentType}`);
    }
    assertRasterDimensions(layer.raster, input.width, input.height);
    assertTransform(layer.raster.transform);
    if (layer.raster.mask) {
      assertRasterDimensions(layer.raster.mask, input.width, input.height);
      assertTransform(layer.raster.mask.transform);
    }
    const opacity = Math.max(0, Math.min(1, layer.opacity));

    for (let y = 0; y < input.height; y += 1) {
      for (let x = 0; x < input.width; x += 1) {
        const offset = (y * input.width + x) * 4;
        const [sourceRed, sourceGreen, sourceBlue, sourceByteAlpha] = sample(layer.raster, x, y);
        const sourceAlpha = (sourceByteAlpha / 255) * opacity * maskAlpha(layer.raster.mask, x, y);
      if (sourceAlpha === 0) continue;
      const destinationAlpha = result[offset + 3] / 255;
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      if (outputAlpha === 0) continue;

      const source = [sourceRed, sourceGreen, sourceBlue];
      for (let channel = 0; channel < 3; channel += 1) {
        const sourceColor = (source[channel] ?? 0) / 255;
        const destinationColor = result[offset + channel] / 255;
        const blendedColor = blendChannel(layer.blendMode, sourceColor, destinationColor);
        result[offset + channel] = clampByte(
          ((1 - sourceAlpha) * destinationColor +
            sourceAlpha * ((1 - destinationAlpha) * sourceColor + destinationAlpha * blendedColor)) /
            outputAlpha *
            255,
        );
      }
      result[offset + 3] = clampByte(outputAlpha * 255);
      }
    }
  }
  return result;
}
