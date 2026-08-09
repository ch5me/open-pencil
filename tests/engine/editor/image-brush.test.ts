import { expect, test } from "bun:test";

import { createContentRevisionId } from "#core/editor/history/journal";
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

test("brush-mask-v1 replay keeps parameters, selection, transaction, and revision hash stable", async () => {
  const config = {
    size: 18,
    hardness: 0.6,
    opacity: 0.8,
    flow: 0.7,
    spacing: 0.25,
    pressure: true,
    smoothing: 0.15,
  } as const;
  const samples = [
    { x: 2, y: 3, pressure: 0.2, time: 1 },
    { x: 4, y: 5, pressure: 0.8, time: 2 },
  ] as const;
  const first = createBrushStroke(mask, config, samples, "tx:brush");
  const replay = createBrushStroke(mask, config, samples, "tx:brush");
  const encode = (stroke: typeof first) => new TextEncoder().encode(JSON.stringify(stroke));
  const firstRevision = await createContentRevisionId("brush-stroke", {}, encode(first));
  const replayRevision = await createContentRevisionId("brush-stroke", {}, encode(replay));
  expect(replayRevision).toBe(firstRevision);
  expect(first.transactionId).toBe("tx:brush");
  expect(selectMask(mask)).toEqual({
    selectedMaskId: "mask:one",
    selectedThumbnailId: "thumb:one",
  });
});

test("palm-touch-like unavailable pressure input creates no false stroke", () => {
  expect(() =>
    createBrushStroke(
      mask,
      { size: 12, hardness: 1, opacity: 1, flow: 1, spacing: 0.1, pressure: true, smoothing: 0 },
      [{ x: 9, y: 9, pressure: 0, time: 4 }],
      "tx:palm",
      false,
    ),
  ).toThrow(BrushDeviceUnavailableError);
});
