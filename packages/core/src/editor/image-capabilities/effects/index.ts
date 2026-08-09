export type RasterEffect = "fill" | "gradient" | "dodge" | "burn" | "smudge" | "blur" | "sharpen";

export type EffectKind =
  | RasterEffect
  | "brightness"
  | "contrast"
  | "saturation"
  | "levels"
  | "curves"
  | "exposure"
  | "vibrance"
  | "hsl"
  | "color-balance"
  | "black-white"
  | "threshold"
  | "posterize"
  | "gradient-map"
  | "selective-color"
  | "noise"
  | "shadows-highlights"
  | "lens"
  | "distortion"
  | "convolution";

export interface EffectFilter {
  readonly id: string;
  readonly kind: EffectKind;
  readonly enabled: boolean;
  readonly affectedArea: readonly [number, number, number, number];
  readonly transactionId: `tx:${string}`;
}

export interface EffectStack {
  readonly layerId: string;
  readonly adjustmentScope: "layer" | "group";
  readonly filters: readonly EffectFilter[];
  readonly effectMaskIds: readonly string[];
  readonly smart: boolean;
}

export class EffectAccelerationUnavailableError extends Error {
  readonly code = "E_EFFECT_ACCELERATION_UNAVAILABLE";
}

export function validateEffectFilter(filter: EffectFilter): void {
  if (!filter.id || !filter.transactionId.startsWith("tx:")) {
    throw new RangeError("invalid effect identity");
  }
  const [x, y, width, height] = filter.affectedArea;
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) {
    throw new RangeError("invalid effect affected area");
  }
}

export function reorderEffectStack(stack: EffectStack, from: number, to: number): EffectStack {
  if (from < 0 || to < 0 || from >= stack.filters.length || to >= stack.filters.length) {
    throw new RangeError("invalid effect reorder");
  }
  const filters = [...stack.filters];
  const [filter] = filters.splice(from, 1);
  if (!filter) throw new RangeError("missing effect filter");
  filters.splice(to, 0, filter);
  return { ...stack, filters };
}

export interface RasterEffectMutation {
  readonly effect: RasterEffect;
  readonly transactionId: `tx:${string}`;
}
