import { expect, test } from "bun:test";

import {
  createImageRuntimeFootprintContract,
  ImageRuntimeFootprintError,
  validateImageRuntimeFootprintContract,
} from "#core/editor/image-footprint";

test("image-runtime-footprint-v1 keeps unmeasured bundle and device values UNKNOWN", () => {
  const contract = createImageRuntimeFootprintContract({
    frameworkNeutralCompositor: "SUPPORTED",
    runtimeVersionStrategy: "SUPPORTED",
  });
  expect(() => validateImageRuntimeFootprintContract(contract)).not.toThrow();
  expect(contract.gzipBudgetBytes).toBe("UNKNOWN");
  expect(contract.lowEndStartupMs).toBe("UNKNOWN");
  expect(contract.lazyGpuLoading).toBe("UNKNOWN");
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
