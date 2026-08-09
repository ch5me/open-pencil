export type ImageQaState = "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";

export interface ImageQaRegressionContract {
  readonly version: "image-qa-regression-v1";
  readonly maskUndo: ImageQaState;
  readonly duplicateMaskGc: ImageQaState;
  readonly archiveReferences: ImageQaState;
  readonly clippingGroupPixels: ImageQaState;
  readonly transformMath: ImageQaState;
  readonly hostileBudgets: ImageQaState;
  readonly psdWarningsCorpus: ImageQaState;
  readonly textureRestoration: ImageQaState;
  readonly realTouch: ImageQaState;
  readonly deviceMatrix: ImageQaState;
  readonly firefoxGpu: ImageQaState;
  readonly orientationThermal: ImageQaState;
  readonly longSession: ImageQaState;
}

export class ImageQaRegressionError extends Error {
  readonly code = "E_IMAGE_QA_REGRESSION_CONTRACT";
}

export function createImageQaRegressionContract(
  overrides: Partial<Omit<ImageQaRegressionContract, "version">> = {},
): ImageQaRegressionContract {
  return {
    version: "image-qa-regression-v1",
    maskUndo: "UNKNOWN",
    duplicateMaskGc: "UNKNOWN",
    archiveReferences: "UNKNOWN",
    clippingGroupPixels: "UNKNOWN",
    transformMath: "UNKNOWN",
    hostileBudgets: "UNKNOWN",
    psdWarningsCorpus: "UNKNOWN",
    textureRestoration: "UNKNOWN",
    realTouch: "UNKNOWN",
    deviceMatrix: "UNKNOWN",
    firefoxGpu: "UNKNOWN",
    orientationThermal: "UNKNOWN",
    longSession: "UNKNOWN",
    ...overrides,
  };
}

export function validateImageQaRegressionContract(contract: ImageQaRegressionContract): void {
  if (contract.version !== "image-qa-regression-v1") {
    throw new ImageQaRegressionError("invalid QA regression version");
  }
  const states = [
    contract.maskUndo,
    contract.duplicateMaskGc,
    contract.archiveReferences,
    contract.clippingGroupPixels,
    contract.transformMath,
    contract.hostileBudgets,
    contract.psdWarningsCorpus,
    contract.textureRestoration,
    contract.realTouch,
    contract.deviceMatrix,
    contract.firefoxGpu,
    contract.orientationThermal,
    contract.longSession,
  ];
  if (
    states.some(
      (state) => state !== "SUPPORTED" && state !== "UNKNOWN" && state !== "UNSUPPORTED",
    )
  ) {
    throw new ImageQaRegressionError("invalid QA regression state");
  }
}
