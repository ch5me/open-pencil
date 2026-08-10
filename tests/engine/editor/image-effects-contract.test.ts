import { describe, expect, test } from "bun:test";

import {
  assertEffectPixelAcceptance,
  type EffectFilter,
  type EffectStack,
  reorderEffectStack,
  updateEffectFilter,
  validateAdjustmentLayerFilter,
} from "#core/editor/image-capabilities/effects";

function stack(): EffectStack {
  const first: EffectFilter = {
    id: "effect:first",
    kind: "brightness",
    enabled: true,
    affectedArea: [0, 0, 1, 1],
    transactionId: "tx:effects",
  };
  return {
    layerId: "layer:one",
    adjustmentScope: "layer",
    filters: [first, { ...first, id: "effect:second", kind: "blur" }],
    effectMaskIds: ["mask:one"],
    smart: true,
  };
}

describe("typed effect contract boundaries", () => {
  test("reorder is immutable and rejects out-of-range positions", () => {
    const original = stack();
    const reordered = reorderEffectStack(original, 0, 1);

    expect(reordered.filters.map((filter) => filter.id)).toEqual(["effect:second", "effect:first"]);
    expect(original.filters.map((filter) => filter.id)).toEqual(["effect:first", "effect:second"]);
    expect(() => reorderEffectStack(original, -1, 0)).toThrow("invalid effect reorder");
    expect(() => reorderEffectStack(original, 0, 2)).toThrow("invalid effect reorder");
  });

  test("filter updates validate the replacement and preserve sibling filters", () => {
    const original = stack();
    const updated = updateEffectFilter(original, "effect:first", {
      kind: "contrast",
      enabled: false,
      adjustments: { amount: 0.5 },
    });

    expect(updated.filters[0]).toMatchObject({
      id: "effect:first",
      kind: "contrast",
      enabled: false,
      adjustments: { amount: 0.5 },
    });
    expect(updated.filters[1]).toEqual(original.filters[1]);
    expect(original.filters[0]).toMatchObject({ kind: "brightness", enabled: true });
    expect(() => updateEffectFilter(original, "missing", { enabled: false })).toThrow(
      "missing effect filter",
    );
    expect(() =>
      updateEffectFilter(original, "effect:first", { affectedArea: [-1, 0, 1, 1] }),
    ).toThrow("invalid effect affected area");
  });

  test("adjustment-layer boundary excludes non-adjustment raster effects", () => {
    const filter = stack().filters[0];
    expect(() => validateAdjustmentLayerFilter(filter)).not.toThrow();
    expect(() => validateAdjustmentLayerFilter({ ...filter, kind: "blur" })).toThrow(
      "unsupported adjustment layer kind",
    );
  });

  test("pixel acceptance protects unaffected pixels and enforces area bound", () => {
    const source = [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255];
    const reference = [...source];
    reference[0] = 11;
    reference[1] = 21;
    reference[2] = 31;
    const accelerated = [...reference];

    expect(() =>
      assertEffectPixelAcceptance(source, reference, accelerated, 2, 2, [0, 0, 1, 1]),
    ).not.toThrow();
    expect(() =>
      assertEffectPixelAcceptance(source, reference, [...reference.slice(0, 4), 41, ...reference.slice(5)], 2, 2, [0, 0, 1, 1]),
    ).toThrow("unrelated pixel changed");
    expect(() =>
      assertEffectPixelAcceptance(source, reference, reference, 2, 2, [0, 0, 2, 2]),
    ).toThrow("effect area exceeds bounded pixel contract");
  });
});
