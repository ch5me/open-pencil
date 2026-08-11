import { expect, test } from "bun:test";

import {
  createImageRuntimeFootprintContract,
  createImageRuntimeFootprintUnknownProof,
  ImageRuntimeFootprintError,
  validateImageRuntimeFootprintContract,
} from "#core/editor/image-footprint";

test("image-runtime-footprint-v1 keeps unmeasured bundle and device values UNKNOWN", () => {
  const contract = createImageRuntimeFootprintContract();
  expect(() => validateImageRuntimeFootprintContract(contract)).not.toThrow();
  expect(contract.gzipBudgetBytes).toBe("UNKNOWN");
  expect(contract.lowEndStartupMs).toBe("UNKNOWN");
  expect(contract.lazyGpuLoading).toBe("UNKNOWN");
  expect(contract.offlineCache).toBe("UNKNOWN");
  expect(contract.runtimeVersionStrategy).toBe("UNKNOWN");
});

test("image-runtime-footprint-v1 emits typed UNKNOWN proof for unobserved consuming surfaces", () => {
  expect(createImageRuntimeFootprintUnknownProof()).toEqual({
    version: "image-runtime-footprint-unknown-v1",
    fields: ["offlineCache", "runtimeVersionStrategy"],
    reason: "consuming-surface-not-observed",
  });
});

test("image-runtime-footprint-v1 validates explicit measurements and rejects invalid budgets", () => {
  const contract = createImageRuntimeFootprintContract({
    gzipBudgetBytes: 250_000,
    lowEndStartupMs: 1200,
    offlineCache: "SUPPORTED",
  });
  expect(() => validateImageRuntimeFootprintContract(contract)).not.toThrow();
  expect(() =>
    validateImageRuntimeFootprintContract({ ...contract, gzipBudgetBytes: -1 }),
  ).toThrow(ImageRuntimeFootprintError);
});
