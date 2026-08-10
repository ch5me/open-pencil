import { validateRasterMask, type RasterMask } from "#core/editor/image-raster";

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

export type BrushMode = "erase" | "reveal";

export interface BrushStroke {
  readonly version: "brush-mask-v1";
  readonly maskId: string;
  readonly mode: BrushMode;
  readonly samples: readonly PointerSample[];
  readonly config: BrushConfig;
  readonly transactionId: `tx:${string}`;
}

export class BrushDeviceUnavailableError extends Error {
  readonly code = "brush-device-unavailable";
}

export function normalizeBrushConfig(config: BrushConfig): BrushConfig {
  if (typeof config.pressure !== "boolean") throw new RangeError("invalid brush pressure");
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

function validatePointerSample(sample: PointerSample): PointerSample {
  if (
    !Number.isFinite(sample.x) ||
    !Number.isFinite(sample.y) ||
    !Number.isFinite(sample.pressure) ||
    sample.pressure < 0 ||
    sample.pressure > 1 ||
    !Number.isFinite(sample.time) ||
    sample.time < 0
  ) {
    throw new RangeError("invalid pointer sample");
  }
  return { ...sample };
}

function validateSamples(samples: readonly PointerSample[]): PointerSample[] {
  let previousTime = -Infinity;
  return samples.map((sample) => {
    const validated = validatePointerSample(sample);
    if (validated.time < previousTime) {
      throw new RangeError("pointer samples must be time ordered");
    }
    previousTime = validated.time;
    return validated;
  });
}

export function createBrushStroke(
  mask: RasterMask,
  config: BrushConfig,
  samples: readonly PointerSample[],
  transactionId: `tx:${string}`,
  pressureAvailable = true,
  mode: BrushMode = "erase",
): BrushStroke {
  const validatedMask = validateRasterMask(mask);
  const normalized = normalizeBrushConfig(config);
  if (!/^tx:.+/u.test(transactionId)) throw new RangeError("invalid brush transaction");
  if (mode !== "erase" && mode !== "reveal") throw new RangeError("invalid brush mode");
  if (normalized.pressure && !pressureAvailable) {
    throw new BrushDeviceUnavailableError("pressure input unavailable");
  }
  return {
    version: "brush-mask-v1",
    maskId: validatedMask.maskId,
    mode,
    samples: validateSamples(samples),
    config: normalized,
    transactionId,
  };
}

export function createEraseBrushStroke(
  mask: RasterMask,
  config: BrushConfig,
  samples: readonly PointerSample[],
  transactionId: `tx:${string}`,
  pressureAvailable = true,
): BrushStroke {
  return createBrushStroke(mask, config, samples, transactionId, pressureAvailable, "erase");
}

export function createRevealBrushStroke(
  mask: RasterMask,
  config: BrushConfig,
  samples: readonly PointerSample[],
  transactionId: `tx:${string}`,
  pressureAvailable = true,
): BrushStroke {
  return createBrushStroke(mask, config, samples, transactionId, pressureAvailable, "reveal");
}
