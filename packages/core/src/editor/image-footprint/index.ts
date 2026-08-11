export type FootprintState = "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";

export interface ImageRuntimeFootprintContract {
  readonly version: "image-runtime-footprint-v1";
  readonly gzipBudgetBytes: number | "UNKNOWN";
  readonly lazyGpuLoading: FootprintState;
  readonly lazyPsdLoading: FootprintState;
  readonly frameworkNeutralCompositor: FootprintState;
  readonly minimalGpuChunks: FootprintState;
  readonly lowEndStartupMs: number | "UNKNOWN";
  readonly offlineCache: FootprintState;
  readonly runtimeVersionStrategy: FootprintState;
}

export interface ImageRuntimeFootprintUnknownProof {
  readonly version: "image-runtime-footprint-unknown-v1";
  readonly fields: readonly ["offlineCache", "runtimeVersionStrategy"];
  readonly reason: "consuming-surface-not-observed";
}

export class ImageRuntimeFootprintError extends Error {
  readonly code = "E_IMAGE_RUNTIME_FOOTPRINT";
}

export const IMAGE_RUNTIME_FOOTPRINT_UNKNOWN_PROOF = {
  version: "image-runtime-footprint-unknown-v1",
  fields: ["offlineCache", "runtimeVersionStrategy"],
  reason: "consuming-surface-not-observed",
} as const satisfies ImageRuntimeFootprintUnknownProof;

export function createImageRuntimeFootprintUnknownProof(): ImageRuntimeFootprintUnknownProof {
  return IMAGE_RUNTIME_FOOTPRINT_UNKNOWN_PROOF;
}

export function createImageRuntimeFootprintContract(
  overrides: Partial<Omit<ImageRuntimeFootprintContract, "version">> = {},
): ImageRuntimeFootprintContract {
  return {
    version: "image-runtime-footprint-v1",
    gzipBudgetBytes: "UNKNOWN",
    lazyGpuLoading: "UNKNOWN",
    lazyPsdLoading: "UNKNOWN",
    frameworkNeutralCompositor: "UNKNOWN",
    minimalGpuChunks: "UNKNOWN",
    lowEndStartupMs: "UNKNOWN",
    offlineCache: "UNKNOWN",
    runtimeVersionStrategy: "UNKNOWN",
    ...overrides,
  };
}

export function validateImageRuntimeFootprintContract(
  contract: ImageRuntimeFootprintContract,
): void {
  if (contract.version !== "image-runtime-footprint-v1") {
    throw new ImageRuntimeFootprintError("invalid runtime footprint version");
  }
  if (
    contract.gzipBudgetBytes !== "UNKNOWN" &&
    (!Number.isSafeInteger(contract.gzipBudgetBytes) || contract.gzipBudgetBytes < 0)
  ) {
    throw new ImageRuntimeFootprintError("invalid gzip budget");
  }
  if (
    contract.lowEndStartupMs !== "UNKNOWN" &&
    (!Number.isFinite(contract.lowEndStartupMs) || contract.lowEndStartupMs < 0)
  ) {
    throw new ImageRuntimeFootprintError("invalid startup measurement");
  }
  const states = [
    contract.lazyGpuLoading,
    contract.lazyPsdLoading,
    contract.frameworkNeutralCompositor,
    contract.minimalGpuChunks,
    contract.offlineCache,
    contract.runtimeVersionStrategy,
  ];
  if (
    states.some(
      (state) => state !== "SUPPORTED" && state !== "UNKNOWN" && state !== "UNSUPPORTED",
    )
  ) {
    throw new ImageRuntimeFootprintError("invalid runtime footprint state");
  }
}
