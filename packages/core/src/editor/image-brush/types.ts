import type { RasterMask } from "#core/editor/image-raster";

export interface BrushConfig {
  readonly size: number;
  readonly hardness: number;
  readonly opacity: number;
  readonly flow: number;
  readonly spacing: number;
  readonly pressure: boolean;
  readonly smoothing: number;
}

export interface PointerSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly time: number;
}

export interface BrushStroke {
  readonly maskId: string;
  readonly samples: readonly PointerSample[];
  readonly config: BrushConfig;
  readonly transactionId: `tx:${string}`;
}

export class BrushDeviceUnavailableError extends Error {
  readonly code = "brush-device-unavailable";
}

export function normalizeBrushConfig(config: BrushConfig): BrushConfig {
  for (const [key, value] of Object.entries(config)) {
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || value < 0 || value > 1) &&
      key !== "size"
    ) {
      throw new RangeError(`invalid brush ${key}`);
    }
  }
  if (!Number.isFinite(config.size) || config.size <= 0) throw new RangeError("invalid brush size");
  return structuredClone(config);
}

export function createBrushStroke(
  mask: RasterMask,
  config: BrushConfig,
  samples: readonly PointerSample[],
  transactionId: `tx:${string}`,
  pressureAvailable = true,
): BrushStroke {
  const normalized = normalizeBrushConfig(config);
  if (normalized.pressure && !pressureAvailable) {
    throw new BrushDeviceUnavailableError("pressure input unavailable");
  }
  return {
    maskId: mask.maskId,
    samples: samples.map((sample) => ({ ...sample })),
    config: normalized,
    transactionId,
  };
}
