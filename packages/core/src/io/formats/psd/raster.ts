import { PsdHostileFileError, type PsdRasterInput, type PsdRasterLayer } from "./types";

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
    assertRasterDimensions(layer.raster, input.width, input.height);
    const opacity = Math.max(0, Math.min(1, layer.opacity));

    for (let offset = 0; offset < result.length; offset += 4) {
      const sourceAlpha = (layer.raster.pixels[offset + 3] / 255) * opacity;
      if (sourceAlpha === 0) continue;
      const destinationAlpha = result[offset + 3] / 255;
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      if (outputAlpha === 0) continue;

      result[offset] = clampByte(
        (layer.raster.pixels[offset] * sourceAlpha +
          result[offset] * destinationAlpha * (1 - sourceAlpha)) /
          outputAlpha,
      );
      result[offset + 1] = clampByte(
        (layer.raster.pixels[offset + 1] * sourceAlpha +
          result[offset + 1] * destinationAlpha * (1 - sourceAlpha)) /
          outputAlpha,
      );
      result[offset + 2] = clampByte(
        (layer.raster.pixels[offset + 2] * sourceAlpha +
          result[offset + 2] * destinationAlpha * (1 - sourceAlpha)) /
          outputAlpha,
      );
      result[offset + 3] = clampByte(outputAlpha * 255);
    }
  }
  return result;
}
