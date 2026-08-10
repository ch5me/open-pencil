import {
  validateRasterMask,
  type RasterDisplayMode,
  type RasterMask,
} from "#core/editor/image-raster";
import type { UndoEntry } from "#core/scene-graph/undo";

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
  readonly pointerType?: "mouse" | "pen" | "touch";
  readonly isPrimary?: boolean;
}

export type BrushMode = "erase" | "reveal";

export type BrushMaskTransform = RasterMask["transform"];

export type BrushMaskControlOperation =
  | "invert"
  | "disable"
  | "delete"
  | "duplicate"
  | "transform"
  | "display-mode"
  | "apply";

export interface BrushStroke {
  readonly version: "brush-mask-v1";
  readonly maskId: string;
  readonly thumbnailId: string;
  readonly maskTransform: BrushMaskTransform;
  readonly displayMode: RasterDisplayMode;
  readonly mode: BrushMode;
  readonly samples: readonly PointerSample[];
  readonly config: BrushConfig;
  readonly transactionId: `tx:${string}`;
}

export interface BrushStrokeHistoryEntry {
  readonly version: "brush-mask-v1";
  readonly kind: "brush-stroke";
  readonly transactionId: `tx:${string}`;
  readonly stroke: BrushStroke;
  readonly before: RasterMask;
  readonly after: RasterMask;
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

export class BrushPalmInputError extends Error {
  readonly code = "brush-palm-input-rejected";
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

export function transformMask(
  mask: RasterMask,
  transform: BrushMaskTransform,
  transactionId: `tx:${string}`,
): BrushMaskControl {
  const validated = validateRasterMask(mask);
  if (
    !Array.isArray(transform) ||
    transform.length !== 6 ||
    transform.some((value) => !Number.isFinite(value))
  ) {
    throw new RangeError("invalid brush mask transform");
  }
  return createMaskControl(
    "transform",
    validated,
    transactionId,
    { ...validated, transform: [...transform] as BrushMaskTransform },
  );
}

export function setMaskDisplayMode(
  mask: RasterMask,
  displayMode: RasterDisplayMode,
  transactionId: `tx:${string}`,
): BrushMaskControl {
  const validated = validateRasterMask(mask);
  if (displayMode !== "overlay" && displayMode !== "grayscale" && displayMode !== "isolate") {
    throw new RangeError("invalid brush mask display mode");
  }
  return createMaskControl("display-mode", validated, transactionId, {
    ...validated,
    displayMode,
  });
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
  if (
    sample.pointerType !== undefined &&
    sample.pointerType !== "mouse" &&
    sample.pointerType !== "pen" &&
    sample.pointerType !== "touch"
  ) {
    throw new RangeError("invalid pointer type");
  }
  if (sample.isPrimary !== undefined && typeof sample.isPrimary !== "boolean") {
    throw new RangeError("invalid pointer primary state");
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

function cloneBrushStroke(stroke: BrushStroke): BrushStroke {
  validateTransactionId(stroke.transactionId);
  if (stroke.version !== "brush-mask-v1") throw new RangeError("invalid brush stroke history");
  if (stroke.mode !== "erase" && stroke.mode !== "reveal") {
    throw new RangeError("invalid brush mode");
  }
  return {
    ...stroke,
    maskTransform: [...stroke.maskTransform] as BrushMaskTransform,
    samples: validateSamples(stroke.samples),
    config: normalizeBrushConfig(stroke.config),
  };
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
  if (samples.some((sample) => sample.pointerType === "touch" || sample.isPrimary === false)) {
    throw new BrushPalmInputError("non-primary touch input cannot create a brush stroke");
  }
  return {
    version: "brush-mask-v1",
    maskId: validatedMask.maskId,
    thumbnailId: validatedMask.thumbnailId,
    maskTransform: [...validatedMask.transform] as BrushMaskTransform,
    displayMode: validatedMask.displayMode,
    mode,
    samples: validateSamples(samples),
    config: normalized,
    transactionId,
  };
}

export function createBrushStrokeHistoryEntry(
  stroke: BrushStroke,
  before: RasterMask,
  after: RasterMask,
): BrushStrokeHistoryEntry {
  const validatedBefore = validateRasterMask(before);
  const validatedAfter = validateRasterMask(after);
  if (stroke.version !== "brush-mask-v1" || stroke.transactionId.startsWith("tx:") === false) {
    throw new RangeError("invalid brush stroke history");
  }
  if (
    stroke.maskId !== validatedBefore.maskId ||
    stroke.maskId !== validatedAfter.maskId ||
    stroke.transactionId.length <= 3
  ) {
    throw new RangeError("brush stroke history mask mismatch");
  }
  return {
    version: "brush-mask-v1",
    kind: "brush-stroke",
    transactionId: stroke.transactionId,
    stroke: structuredClone(stroke),
    before: validatedBefore,
    after: validatedAfter,
  };
}

export function createBrushStrokeUndoEntry(
  history: BrushStrokeHistoryEntry,
  applyMaskState: (mask: RasterMask) => void,
): UndoEntry {
  const entry = createBrushStrokeHistoryEntry(history.stroke, history.before, history.after);
  return {
    label: `Brush stroke ${entry.transactionId}`,
    forward: () => applyMaskState(structuredClone(entry.after)),
    inverse: () => applyMaskState(structuredClone(entry.before)),
  };
}

export function replayBrushStroke(
  stroke: BrushStroke,
  applySample: (sample: PointerSample, index: number, stroke: BrushStroke) => void,
): void {
  const replay = cloneBrushStroke(stroke);
  replay.samples.forEach((sample, index) => applySample(sample, index, replay));
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
