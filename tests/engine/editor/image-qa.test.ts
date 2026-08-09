import { expect, test } from "bun:test";

import {
  createImageQaRegressionContract,
  ImageQaRegressionError,
  validateImageQaRegressionContract,
} from "#core/editor/image-qa";

test("image-qa-regression-v1 records deterministic core checks and unknown device boundaries", () => {
  const contract = createImageQaRegressionContract({
    maskUndo: "SUPPORTED",
    duplicateMaskGc: "SUPPORTED",
    archiveReferences: "SUPPORTED",
    clippingGroupPixels: "SUPPORTED",
    transformMath: "SUPPORTED",
    hostileBudgets: "SUPPORTED",
    textureRestoration: "SUPPORTED",
  });
  expect(() => validateImageQaRegressionContract(contract)).not.toThrow();
  expect(contract.realTouch).toBe("UNKNOWN");
  expect(contract.firefoxGpu).toBe("UNKNOWN");
  expect(contract.orientationThermal).toBe("UNKNOWN");
});

test("image-qa-regression-v1 rejects malformed state", () => {
  const contract = createImageQaRegressionContract();
  expect(() =>
    validateImageQaRegressionContract({ ...contract, maskUndo: "maybe" }),
  ).toThrow(ImageQaRegressionError);
});
