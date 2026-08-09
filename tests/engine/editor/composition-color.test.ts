import { expect, test } from "bun:test";

import {
  assertPixelOracle,
  assertPixelParity,
  COMPOSITION_COLOR_CONTRACT,
  COMPOSITION_COLOR_CONTRACT_VERSION,
} from "#core/color/composition";

test("composition color contract uses document-linear premultiplied semantics", () => {
  expect(COMPOSITION_COLOR_CONTRACT.version).toBe(COMPOSITION_COLOR_CONTRACT_VERSION);
  expect(COMPOSITION_COLOR_CONTRACT.workingSpace).toBe("document-primaries-linear");
  expect(COMPOSITION_COLOR_CONTRACT.alpha).toBe("premultiplied");
  expect(COMPOSITION_COLOR_CONTRACT.formats).toEqual([
    "rgba8-srgb",
    "rgba16f-linear-premultiplied",
  ]);
});

test("composition pixel oracle allows declared quantization tolerance", () => {
  assertPixelOracle([0, 0.5, 1, 1], [0, 0.5 + 1 / 255, 1, 1], {
    format: "rgba8-srgb",
  });
  expect(() =>
    assertPixelOracle([0, 0.5, 1, 1], [0, 0.51, 1, 1], {
      format: "rgba8-srgb",
    }),
  ).toThrow("pixel oracle mismatch");
});

test("composition-full-v1 parity fixture keeps CPU and GPU paths within one-pixel contract", () => {
  const expectedRgba8 = [24, 32, 48, 255, 240, 224, 208, 255];
  const cpu = [24, 32, 48, 255, 240, 224, 208, 255];
  const webgpu = [25, 31, 49, 255, 239, 225, 207, 255];
  const webgl2 = [22, 34, 46, 255, 241, 223, 209, 255];
  for (const actual of [cpu, webgpu, webgl2]) {
    assertPixelParity(actual, expectedRgba8, { maxChannelDelta: 3, maxMeanBias: 0.25 });
  }
  assertPixelParity(
    [0.25, 0.5, 0.75, 1, 0.1, 0.2, 0.3, 1],
    [0.2505, 0.4995, 0.7505, 1, 0.0995, 0.2005, 0.2995, 1],
    { maxChannelDelta: 1e-3, maxMeanBias: 1e-3 },
  );
});
