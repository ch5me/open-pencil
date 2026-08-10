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

export type BrushMaskControlOperation = "invert" | "disable" | "delete" | "duplicate" | "apply";

export interface BrushStroke {
  readonly version: "brush-mask-v1";
  readonly maskId: string;
  readonly thumbnailId: string;
  readonly mode: BrushMode;
  readonly samples: readonly PointerSample[];
  readonly config: BrushConfig;
  readonly transactionId: `tx:${string}`;
}

export interface BrushMaskControl {
  readonly version: "brush-mask-v1";
  readonly operation: BrushMaskControlOperation;
  readonly maskId: string;
  readonly transactionId: `tx:${string}`;
  readonly mask: RasterMask | null;
  readonly deleted: boolean;
  readonly applied: boolean;
}

export class BrushDeviceUnavailableError extends Error {
  readonly code = "brush-device-unavailable";
}

export class BrushMaskCapabilityUnavailableError extends Error {
  readonly code = "brush-mask-capability-unavailable";
}

function validateTransactionId(transactionId: `tx:${string}`): void {
  if (!/^tx:.+/u.test(transactionId)) throw new RangeError("invalid brush transaction");
}

function createMaskControl(
  operation: BrushMaskControlOperation,
  mask: RasterMask,
  transactionId: `tx:${string}`,
  nextMask: RasterMask | null,
  deleted = false,
  applied = false,
): BrushMaskControl {
  const validatedMask = validateRasterMask(mask);
  validateTransactionId(transactionId);
  return {
    version: "brush-mask-v1",
    operation,
    maskId: validatedMask.maskId,
    transactionId,
    mask: nextMask ? validateRasterMask(nextMask) : null,
    deleted,
    applied,
  };
}

export function invertMask(mask: RasterMask, transactionId: `tx:${string}`): BrushMaskControl {
  const validated = validateRasterMask(mask);
  return createMaskControl(
    "invert",
    validated,
    transactionId,
    { ...validated, inverted: !validated.inverted },
  );
}

export function disableMask(mask: RasterMask, transactionId: `tx:${string}`): BrushMaskControl {
  const validated = validateRasterMask(mask);
  return createMaskControl("disable", validated, transactionId, { ...validated, enabled: false });
}

export function deleteMask(mask: RasterMask, transactionId: `tx:${string}`): BrushMaskControl {
  return createMaskControl("delete", mask, transactionId, null, true);
}

function duplicateId(id: string, transactionId: `tx:${string}`): string {
  return `${id}:duplicate:${transactionId.slice(3)}`;
}

export function duplicateMask(mask: RasterMask, transactionId: `tx:${string}`): BrushMaskControl {
  const validated = validateRasterMask(mask);
  const duplicate = {
    ...validated,
    maskId: duplicateId(validated.maskId, transactionId),
    thumbnailId: duplicateId(validated.thumbnailId, transactionId),
  };
  return createMaskControl("duplicate", validated, transactionId, duplicate);
}

export function applyMask(
  mask: RasterMask,
  transactionId: `tx:${string}`,
  pixelApplyAvailable = false,
): BrushMaskControl {
  if (!pixelApplyAvailable) {
    throw new BrushMaskCapabilityUnavailableError("mask pixel application unavailable");
  }
  return createMaskControl("apply", mask, transactionId, null, true, true);
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
  validateTransactionId(transactionId);
  if (mode !== "erase" && mode !== "reveal") throw new RangeError("invalid brush mode");
  if (normalized.pressure && !pressureAvailable) {
    throw new BrushDeviceUnavailableError("pressure input unavailable");
  }
  return {
    version: "brush-mask-v1",
    maskId: validatedMask.maskId,
    thumbnailId: validatedMask.thumbnailId,
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
