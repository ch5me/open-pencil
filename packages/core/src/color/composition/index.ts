export const COMPOSITION_COLOR_CONTRACT_VERSION = "composition-color:1";

export interface CompositionColorContract {
  readonly version: typeof COMPOSITION_COLOR_CONTRACT_VERSION;
  readonly workingSpace: "document-primaries-linear";
  readonly alpha: "premultiplied";
  readonly quantization: "declared-by-backend";
}

export const COMPOSITION_COLOR_CONTRACT: CompositionColorContract = {
  version: COMPOSITION_COLOR_CONTRACT_VERSION,
  workingSpace: "document-primaries-linear",
  alpha: "premultiplied",
  quantization: "declared-by-backend",
};
