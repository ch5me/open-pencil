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

export type AdjustmentLayerKind =
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
  | "selective-color";

const ADJUSTMENT_LAYER_KINDS: ReadonlySet<AdjustmentLayerKind> = new Set([
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

const EFFECT_KINDS: ReadonlySet<string> = new Set<EffectKind>([
  "fill",
  "gradient",
  "dodge",
  "burn",
  "smudge",
  "blur",
  "sharpen",
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
  "noise",
  "shadows-highlights",
  "lens",
  "distortion",
  "convolution",
]);

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
  override readonly name = "EffectAccelerationUnavailableError";
}

export class EffectPixelAcceptanceError extends Error {
  readonly code = "E_EFFECT_PIXEL_ACCEPTANCE";
  override readonly name = "EffectPixelAcceptanceError";
}

export interface EffectPixelAcceptanceOptions {
  readonly maxChannelDelta?: number;
  readonly maxMeanBias?: number;
}

export type EffectPixel = readonly [number, number, number, number];
export type EffectPixelAdjustment = (pixel: EffectPixel) => EffectPixel;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function control(
  adjustments: Readonly<Partial<Record<string, number>>>,
  key: string,
  fallback: number,
): number {
  const value = adjustments[key];
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = (r - g) / delta + 4;
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / delta + 2;
  hue /= 6;
  return [hue, saturation, lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  if (saturation === 0) {
    const gray = clampByte(lightness * 255);
    return [gray, gray, gray];
  }
  const hueToRgb = (p: number, q: number, t: number): number => {
    let wrapped = t;
    if (wrapped < 0) wrapped += 1;
    else if (wrapped > 1) wrapped -= 1;
    if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
    if (wrapped < 1 / 2) return q;
    if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
    return p;
  };
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [
    clampByte(hueToRgb(p, q, hue + 1 / 3) * 255),
    clampByte(hueToRgb(p, q, hue) * 255),
    clampByte(hueToRgb(p, q, hue - 1 / 3) * 255),
  ];
}

function seededNoise(pixel: EffectPixel): number {
  let value =
    (pixel[0] * 374761393 + pixel[1] * 668265263 + pixel[2] * 2147483647 + pixel[3]) |
    0;
  value = (value ^ (value >>> 13)) * 1274126177;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}

/**
 * Builds the host-neutral CPU reference adjustment for a typed effect kind.
 * Controls are normalized numeric values; missing controls use identity defaults.
 */
export function createRasterEffectAdjustment(
  kind: EffectKind,
  adjustments: Readonly<Record<string, number>> = {},
): EffectPixelAdjustment {
  switch (kind) {
    case "levels": {
      const inputBlack = control(adjustments, "inputBlack", 0);
      const inputWhite = Math.max(inputBlack + 1, control(adjustments, "inputWhite", 255));
      const gamma = Math.max(0.01, control(adjustments, "gamma", 1));
      const outputBlack = control(adjustments, "outputBlack", 0);
      const outputWhite = control(adjustments, "outputWhite", 255);
      return ([r, g, b, a]) => {
        const map = (value: number) => outputBlack + (((Math.max(inputBlack, Math.min(inputWhite, value)) - inputBlack) / (inputWhite - inputBlack)) ** (1 / gamma)) * (outputWhite - outputBlack);
        return [clampByte(map(r)), clampByte(map(g)), clampByte(map(b)), a];
      };
    }
    case "curves": {
      const midpoint = Math.max(0.01, control(adjustments, "midpoint", 1));
      return ([r, g, b, a]) => {
        const map = (value: number) => 255 * (value / 255) ** (1 / midpoint);
        return [clampByte(map(r)), clampByte(map(g)), clampByte(map(b)), a];
      };
    }
    case "exposure": {
      const scale = 2 ** control(adjustments, "exposure", 0);
      return ([r, g, b, a]) => [clampByte(r * scale), clampByte(g * scale), clampByte(b * scale), a];
    }
    case "vibrance": {
      const amount = control(adjustments, "vibrance", 0);
      return ([r, g, b, a]) => {
        const average = (r + g + b) / 3;
        const max = Math.max(r, g, b);
        const factor = 1 + amount * (1 - (max - average) / 255);
        return [clampByte(average + (r - average) * factor), clampByte(average + (g - average) * factor), clampByte(average + (b - average) * factor), a];
      };
    }
    case "hsl": {
      const hueShift = control(adjustments, "hue", 0) / 360;
      const saturationShift = control(adjustments, "saturation", 0);
      const lightnessShift = control(adjustments, "lightness", 0);
      return ([r, g, b, a]) => {
        const [hue, saturation, lightness] = rgbToHsl(r, g, b);
        return [...hslToRgb((hue + hueShift + 1) % 1, Math.max(0, Math.min(1, saturation + saturationShift)), Math.max(0, Math.min(1, lightness + lightnessShift))), a];
      };
    }
    case "color-balance": {
      const shadows = control(adjustments, "shadows", 0);
      const midtones = control(adjustments, "midtones", 0);
      const highlights = control(adjustments, "highlights", 0);
      return ([r, g, b, a]) => {
        const luminance = (r + g + b) / (255 * 3);
        let amount = midtones;
        if (luminance < 0.33) amount = shadows;
        else if (luminance > 0.66) amount = highlights;
        return [clampByte(r + amount), clampByte(g - amount / 2), clampByte(b - amount / 2), a];
      };
    }
    case "black-white": {
      const red = control(adjustments, "red", 0.299);
      const green = control(adjustments, "green", 0.587);
      const blue = control(adjustments, "blue", 0.114);
      return ([r, g, b, a]) => {
        const gray = clampByte(r * red + g * green + b * blue);
        return [gray, gray, gray, a];
      };
    }
    case "threshold": {
      const threshold = control(adjustments, "threshold", 128);
      return ([r, g, b, a]) => {
        const gray = r * 0.299 + g * 0.587 + b * 0.114 >= threshold ? 255 : 0;
        return [gray, gray, gray, a];
      };
    }
    case "posterize": {
      const levels = Math.max(2, Math.round(control(adjustments, "levels", 4)));
      return ([r, g, b, a]) => {
        const map = (value: number) => Math.round(Math.round((value / 255) * (levels - 1)) * (255 / (levels - 1)));
        return [map(r), map(g), map(b), a];
      };
    }
    case "gradient-map": {
      const start: [number, number, number] = [control(adjustments, "startR", 0), control(adjustments, "startG", 0), control(adjustments, "startB", 0)];
      const end: [number, number, number] = [control(adjustments, "endR", 255), control(adjustments, "endG", 255), control(adjustments, "endB", 255)];
      return ([r, g, b, a]) => {
        const amount = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        return [clampByte(start[0] + (end[0] - start[0]) * amount), clampByte(start[1] + (end[1] - start[1]) * amount), clampByte(start[2] + (end[2] - start[2]) * amount), a];
      };
    }
    case "selective-color": {
      const red = control(adjustments, "red", 0);
      const green = control(adjustments, "green", 0);
      const blue = control(adjustments, "blue", 0);
      return ([r, g, b, a]) => [clampByte(r + red), clampByte(g + green), clampByte(b + blue), a];
    }
    case "sharpen": {
      const amount = control(adjustments, "amount", 1);
      return ([r, g, b, a]) => {
        const average = (r + g + b) / 3;
        return [
          clampByte(r + (r - average) * amount),
          clampByte(g + (g - average) * amount),
          clampByte(b + (b - average) * amount),
          a,
        ];
      };
    }
    case "noise": {
      const amount = control(adjustments, "amount", 0.1) * 255;
      return (pixel) => {
        const offset = seededNoise(pixel) * amount;
        return [
          clampByte(pixel[0] + offset),
          clampByte(pixel[1] + offset),
          clampByte(pixel[2] + offset),
          pixel[3],
        ];
      };
    }
    case "shadows-highlights": {
      const shadows = control(adjustments, "shadows", 0);
      const highlights = control(adjustments, "highlights", 0);
      return ([r, g, b, a]) => {
        const luminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        const amount = luminance < 0.5 ? shadows * (1 - luminance * 2) : highlights * ((luminance - 0.5) * 2);
        return [clampByte(r + amount * 255), clampByte(g + amount * 255), clampByte(b + amount * 255), a];
      };
    }
    case "lens": {
      const amount = control(adjustments, "amount", 0);
      return ([r, g, b, a]) => [
        clampByte(128 + (r - 128) * (1 + amount)),
        clampByte(128 + (g - 128) * (1 + amount)),
        clampByte(128 + (b - 128) * (1 + amount)),
        a,
      ];
    }
    case "distortion": {
      const amount = control(adjustments, "amount", 0);
      return ([r, g, b, a]) => [
        clampByte(r + (g - b) * amount),
        clampByte(g + (b - r) * amount),
        clampByte(b + (r - g) * amount),
        a,
      ];
    }
    case "convolution": {
      const amount = control(adjustments, "amount", 1);
      const center = control(adjustments, "center", 1);
      return ([r, g, b, a]) => [
        clampByte(r * center + (r - 128) * amount),
        clampByte(g * center + (g - 128) * amount),
        clampByte(b * center + (b - 128) * amount),
        a,
      ];
    }
    default:
      return (pixel) => pixel;
  }
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
  if (
    !filter.id ||
    !EFFECT_KINDS.has(filter.kind) ||
    typeof filter.enabled !== "boolean" ||
    !filter.transactionId.startsWith("tx:")
  ) {
    throw new RangeError("invalid effect identity");
  }
  const [x, y, width, height] = filter.affectedArea;
  if (
    ![x, y, width, height].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    width < 0 ||
    height < 0
  ) {
    throw new RangeError("invalid effect affected area");
  }
  if (
    filter.adjustments &&
    Object.values(filter.adjustments).some((value) => !Number.isFinite(value))
  ) {
    throw new RangeError("invalid effect adjustments");
  }
}

export function isAdjustmentLayerKind(kind: EffectKind): kind is AdjustmentLayerKind {
  return ADJUSTMENT_LAYER_KINDS.has(kind as AdjustmentLayerKind);
}

export function validateAdjustmentLayerFilter(filter: EffectFilter): void {
  validateEffectFilter(filter);
  if (!isAdjustmentLayerKind(filter.kind)) {
    throw new RangeError("unsupported adjustment layer kind");
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
  if (index === -1) throw new RangeError("missing effect filter");
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
