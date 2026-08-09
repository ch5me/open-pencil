import { expect, test } from "bun:test";

import { BrushDeviceUnavailableError, createBrushStroke } from "#core/editor/image-brush";
import type { RasterMask } from "#core/editor/image-raster";
import { selectMask } from "#core/editor/image-selection";

const mask: RasterMask = {
  maskId: "mask:one",
  revisionId: `sha256:${"a".repeat(64)}`,
  thumbnailId: "thumb:one",
  enabled: true,
  inverted: false,
  displayMode: "overlay",
  transform: [1, 0, 0, 1, 0, 0],
};

test("brush stroke preserves deterministic samples and one transaction", () => {
  const stroke = createBrushStroke(
    mask,
    {
      size: 24,
      hardness: 0.8,
      opacity: 1,
      flow: 0.7,
      spacing: 0.2,
      pressure: true,
      smoothing: 0.1,
    },
    [{ x: 1, y: 2, pressure: 0.5, time: 10 }],
    "tx:brush",
  );
  expect(stroke.maskId).toBe(mask.maskId);
  expect(stroke.transactionId).toBe("tx:brush");
  expect(stroke.samples).toHaveLength(1);
  expect(selectMask(mask).selectedThumbnailId).toBe("thumb:one");
});

test("pressure-dependent brush fails loud without device support", () => {
  expect(() =>
    createBrushStroke(
      mask,
      { size: 8, hardness: 1, opacity: 1, flow: 1, spacing: 0.1, pressure: true, smoothing: 0 },
      [],
      "tx:brush",
      false,
    ),
  ).toThrow(BrushDeviceUnavailableError);
});
