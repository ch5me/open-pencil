export const COMPOSITION_COLOR_CONTRACT_VERSION = "composition-color:1";

export type CompositionPixelFormat = "rgba8-srgb" | "rgba16f-linear-premultiplied";

export interface CompositionColorContract {
  readonly version: typeof COMPOSITION_COLOR_CONTRACT_VERSION;
  readonly workingSpace: "document-primaries-linear";
  readonly alpha: "premultiplied";
  readonly quantization: "declared-by-backend";
  readonly formats: readonly CompositionPixelFormat[];
  readonly rgba8Tolerance: number;
  readonly rgba16fTolerance: number;
}

export const COMPOSITION_COLOR_CONTRACT: CompositionColorContract = {
  version: COMPOSITION_COLOR_CONTRACT_VERSION,
  workingSpace: "document-primaries-linear",
  alpha: "premultiplied",
  quantization: "declared-by-backend",
  formats: ["rgba8-srgb", "rgba16f-linear-premultiplied"],
  rgba8Tolerance: 1 / 255,
  rgba16fTolerance: 1 / 1024,
};

export interface PixelOracleOptions {
  readonly format: CompositionPixelFormat;
  readonly maxChannelDelta?: number;
}

export interface PixelParityOptions {
  readonly maxChannelDelta: number;
  readonly maxMeanBias: number;
}

export function assertPixelOracle(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  options: PixelOracleOptions,
): void {
  if (actual.length !== expected.length || actual.length % 4 !== 0) {
    throw new Error(`pixel oracle length mismatch for ${options.format}`);
  }
  const tolerance =
    options.maxChannelDelta ??
    (options.format === "rgba8-srgb"
      ? COMPOSITION_COLOR_CONTRACT.rgba8Tolerance
      : COMPOSITION_COLOR_CONTRACT.rgba16fTolerance);
  for (let index = 0; index < actual.length; index += 1) {
    if (Math.abs(actual[index] - expected[index]) > tolerance) {
      throw new Error(
        `pixel oracle mismatch at channel ${index}: ${actual[index]} vs ${expected[index]} (tolerance ${tolerance})`,
      );
    }
  }
}

export function assertPixelParity(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  options: PixelParityOptions,
): void {
  if (actual.length !== expected.length || actual.length % 4 !== 0) {
    throw new Error("pixel parity length mismatch");
  }
  let bias = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const delta = actual[index] - expected[index];
    if (Math.abs(delta) > options.maxChannelDelta) {
      throw new Error(`pixel parity max delta exceeded at channel ${index}`);
    }
    bias += delta;
  }
  if (Math.abs(bias / actual.length) > options.maxMeanBias) {
    throw new Error("pixel parity mean bias exceeded");
  }
}
