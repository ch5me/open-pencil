import { expect, test } from "bun:test";

import {
  assertPixelOracle,
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
