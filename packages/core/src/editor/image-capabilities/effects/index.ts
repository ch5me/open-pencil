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
  /**
   * Normalized adjustment controls. Raster effects may omit this field.
   * Keeping controls numeric makes the contract serializable and host-neutral.
   */
  readonly adjustments?: Readonly<Record<string, number>>;
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

export class EffectPixelAcceptanceError extends Error {
  readonly code = "E_EFFECT_PIXEL_ACCEPTANCE";
}

export interface EffectPixelAcceptanceOptions {
  readonly maxChannelDelta?: number;
  readonly maxMeanBias?: number;
}

function pixelIndex(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

/**
 * Checks the CPU reference and accelerated effect output at the pixel boundary.
 * Pixels outside the declared effect area must stay byte-identical.
 */
export function assertEffectPixelAcceptance(
  source: readonly number[],
  reference: readonly number[],
  accelerated: readonly number[],
  width: number,
  height: number,
  affectedArea: readonly [number, number, number, number],
  options: EffectPixelAcceptanceOptions = {},
): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new EffectPixelAcceptanceError("invalid pixel dimensions");
  }
  const expectedLength = width * height * 4;
  if (source.length !== expectedLength || reference.length !== expectedLength) {
    throw new EffectPixelAcceptanceError("invalid reference pixel length");
  }
  if (accelerated.length !== expectedLength) {
    throw new EffectPixelAcceptanceError("invalid accelerated pixel length");
  }
  const [x, y, areaWidth, areaHeight] = affectedArea;
  if (
    ![x, y, areaWidth, areaHeight].every(Number.isInteger) ||
    areaWidth < 0 ||
    areaHeight < 0 ||
    x < 0 ||
    y < 0 ||
    x + areaWidth > width ||
    y + areaHeight > height ||
    (areaWidth * areaHeight) / (width * height) > 0.25
  ) {
    throw new EffectPixelAcceptanceError("effect area exceeds bounded pixel contract");
  }
  const maxChannelDelta = options.maxChannelDelta ?? 0;
  const maxMeanBias = options.maxMeanBias ?? 0;
  if (maxChannelDelta < 0 || maxMeanBias < 0) {
    throw new EffectPixelAcceptanceError("invalid pixel tolerance");
  }
  let comparedChannels = 0;
  let totalBias = 0;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const inside =
        column >= x && column < x + areaWidth && row >= y && row < y + areaHeight;
      const index = pixelIndex(width, column, row);
      for (let channel = 0; channel < 4; channel += 1) {
        const actual = accelerated[index + channel] ?? 0;
        const expected = (inside ? reference : source)[index + channel] ?? 0;
        const delta = Math.abs(actual - expected);
        if (!inside && delta !== 0) {
          throw new EffectPixelAcceptanceError("unrelated pixel changed");
        }
        if (inside) {
          if (delta > maxChannelDelta) {
            throw new EffectPixelAcceptanceError("accelerated pixel exceeds tolerance");
          }
          comparedChannels += 1;
          totalBias += delta;
        }
      }
    }
  }
  if (comparedChannels > 0 && totalBias / comparedChannels > maxMeanBias) {
    throw new EffectPixelAcceptanceError("accelerated pixel mean bias exceeds tolerance");
  }
}

export function validateEffectFilter(filter: EffectFilter): void {
  if (!filter.id || typeof filter.enabled !== "boolean" || !filter.transactionId.startsWith("tx:")) {
    throw new RangeError("invalid effect identity");
  }
  const [x, y, width, height] = filter.affectedArea;
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) {
    throw new RangeError("invalid effect affected area");
  }
  if (
    filter.adjustments &&
    Object.values(filter.adjustments).some((value) => !Number.isFinite(value))
  ) {
    throw new RangeError("invalid effect adjustments");
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

export type EffectFilterPatch = Partial<
  Pick<EffectFilter, "kind" | "enabled" | "affectedArea" | "transactionId" | "adjustments">
>;

export function validateEffectStack(stack: EffectStack): void {
  if (!stack.layerId || (stack.adjustmentScope !== "layer" && stack.adjustmentScope !== "group")) {
    throw new RangeError("invalid effect stack identity");
  }
  const ids = new Set<string>();
  for (const filter of stack.filters) {
    validateEffectFilter(filter);
    if (ids.has(filter.id)) throw new RangeError("duplicate effect filter id");
    ids.add(filter.id);
  }
  const maskIds = new Set<string>();
  for (const maskId of stack.effectMaskIds) {
    if (!maskId || maskIds.has(maskId)) throw new RangeError("invalid effect mask id");
    maskIds.add(maskId);
  }
}

export function updateEffectFilter(
  stack: EffectStack,
  filterId: string,
  patch: EffectFilterPatch,
): EffectStack {
  const index = stack.filters.findIndex((filter) => filter.id === filterId);
  if (index < 0) throw new RangeError("missing effect filter");
  const filters = [...stack.filters];
  const current = filters[index];
  if (!current) throw new RangeError("missing effect filter");
  const next = { ...current, ...patch };
  validateEffectFilter(next);
  filters[index] = next;
  const updated = { ...stack, filters };
  validateEffectStack(updated);
  return updated;
}

export function setEffectEnabled(stack: EffectStack, filterId: string, enabled: boolean): EffectStack {
  return updateEffectFilter(stack, filterId, { enabled });
}
