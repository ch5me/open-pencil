import { describe, expect, test } from "bun:test";

import {
  createRasterEffectAdjustment,
  type EffectKind,
} from "#core/editor/image-capabilities/effects";

describe("typed raster effect references", () => {
  const source = [40, 90, 180, 255] as const;

  const cases: readonly [EffectKind, Readonly<Record<string, number>>][] = [
    ["sharpen", { amount: 1 }],
    ["noise", { amount: 0.25 }],
    ["shadows-highlights", { shadows: 0.5, highlights: -0.5 }],
    ["lens", { amount: 0.5 }],
    ["distortion", { amount: 0.5 }],
    ["convolution", { amount: 0.5, center: 1 }],
  ];

  test.each(cases)("%s changes the reference pixel", (kind, adjustments) => {
    const output = createRasterEffectAdjustment(kind, adjustments)(source);
    expect(output).not.toEqual(source);
    expect(output[3]).toBe(source[3]);
    expect(output.slice(0, 3).every((channel) => channel >= 0 && channel <= 255)).toBe(true);
  });

  test("noise reference is deterministic", () => {
    const adjustment = createRasterEffectAdjustment("noise", { amount: 0.2 });
    expect(adjustment(source)).toEqual(adjustment(source));
  });
});
