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

test("composition pixel oracles reject malformed buffers and honor explicit tolerance", () => {
  expect(() =>
    assertPixelOracle([0, 0, 0], [0, 0, 0], { format: "rgba8-srgb" }),
  ).toThrow("pixel oracle length mismatch");
  expect(() =>
    assertPixelOracle([0, 0, 0, 1], [0, 0, 0, 1.01], {
      format: "rgba8-srgb",
      maxChannelDelta: 0.02,
    }),
  ).not.toThrow();
});

test("composition parity rejects channel drift and aggregate bias", () => {
  expect(() =>
    assertPixelParity([0, 0, 0, 1], [0.2, 0, 0, 1], {
      maxChannelDelta: 0.1,
      maxMeanBias: 1,
    }),
  ).toThrow("pixel parity max delta exceeded");
  expect(() =>
    assertPixelParity([0.2, 0.2, 0.2, 1], [0, 0, 0, 1], {
      maxChannelDelta: 1,
      maxMeanBias: 0.05,
    }),
  ).toThrow("pixel parity mean bias exceeded");
});

test("composition parity fixture keeps signed mean bias within the explicit contract", () => {
  const expected = [24, 32, 48, 255];
  const maxChannelDelta = 3;
  const maxMeanBias = 0.25;

  expect(() =>
    assertPixelParity([27, 35, 51, 258], expected, {
      maxChannelDelta,
      maxMeanBias,
    }),
  ).toThrow("pixel parity mean bias exceeded");
  expect(() =>
    assertPixelParity([24.25, 32.25, 48.25, 255.25], expected, {
      maxChannelDelta,
      maxMeanBias,
    }),
  ).not.toThrow();
});
