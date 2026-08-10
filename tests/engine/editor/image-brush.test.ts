import { expect, test } from "bun:test";

import { createContentRevisionId } from "#core/editor/history/journal";
import {
  applyMask,
  BrushDeviceUnavailableError,
  BrushMaskCapabilityUnavailableError,
  createBrushStroke,
  createEraseBrushStroke,
  createRevealBrushStroke,
  deleteMask,
  disableMask,
  duplicateMask,
  invertMask,
  setMaskDisplayMode,
  transformMask,
} from "#core/editor/image-brush";
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
  expect(stroke.version).toBe("brush-mask-v1");
  expect(stroke.mode).toBe("erase");
  expect(stroke.maskId).toBe(mask.maskId);
  expect(stroke.thumbnailId).toBe(mask.thumbnailId);
  expect(stroke.maskTransform).toEqual(mask.transform);
  expect(stroke.displayMode).toBe("overlay");
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
  expect(first.thumbnailId).toBe("thumb:one");
  expect(replay.thumbnailId).toBe(first.thumbnailId);
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

test("non-pressure brush accepts unavailable pressure input", () => {
  const stroke = createBrushStroke(
    mask,
    { size: 12, hardness: 1, opacity: 1, flow: 1, spacing: 0.1, pressure: false, smoothing: 0 },
    [{ x: 9, y: 9, pressure: 0, time: 4 }],
    "tx:mouse",
    false,
  );
  expect(stroke.transactionId).toBe("tx:mouse");
});

test("erase and reveal helpers preserve one transaction and mode", () => {
  const config = {
    size: 12,
    hardness: 1,
    opacity: 1,
    flow: 1,
    spacing: 0.1,
    pressure: false,
    smoothing: 0,
  } as const;
  const samples = [{ x: 1, y: 2, pressure: 1, time: 1 }] as const;
  expect(createEraseBrushStroke(mask, config, samples, "tx:erase").mode).toBe("erase");
  expect(createRevealBrushStroke(mask, config, samples, "tx:reveal").mode).toBe("reveal");
});

test("brush rejects invalid transaction ids and non-deterministic sample order", () => {
  const config = {
    size: 12,
    hardness: 1,
    opacity: 1,
    flow: 1,
    spacing: 0.1,
    pressure: false,
    smoothing: 0,
  } as const;
  expect(() => createBrushStroke(mask, config, [], "invalid" as `tx:${string}`)).toThrow(
    "invalid brush transaction",
  );
  expect(() =>
    createBrushStroke(
      mask,
      config,
      [
        { x: 1, y: 2, pressure: 1, time: 2 },
        { x: 2, y: 3, pressure: 1, time: 1 },
      ],
      "tx:ordered",
    ),
  ).toThrow("pointer samples must be time ordered");
});

test("brush rejects invalid pointer samples and malformed masks", () => {
  expect(() =>
    createBrushStroke(
      mask,
      { size: 12, hardness: 1, opacity: 1, flow: 1, spacing: 0.1, pressure: false, smoothing: 0 },
      [{ x: Number.NaN, y: 9, pressure: 0, time: 4 }],
      "tx:invalid",
    ),
  ).toThrow("invalid pointer sample");
  expect(() =>
    createBrushStroke(
      { ...mask, revisionId: "sha256:bad" as typeof mask.revisionId },
      { size: 12, hardness: 1, opacity: 1, flow: 1, spacing: 0.1, pressure: false, smoothing: 0 },
      [],
      "tx:invalid-mask",
    ),
  ).toThrow("invalid raster mask");
});

test("brush validates every numeric control and keeps caller data detached", () => {
  const config = {
    size: 12,
    hardness: 0.8,
    opacity: 0.7,
    flow: 0.6,
    spacing: 0.2,
    pressure: true,
    smoothing: 0.15,
  };
  const samples = [{ x: 1, y: 2, pressure: 0.5, time: 1 }];
  const stroke = createBrushStroke(mask, config, samples, "tx:detached");

  config.size = 24;
  config.hardness = 0;
  config.opacity = 0;
  config.flow = 0;
  config.spacing = 1;
  config.smoothing = 1;
  samples[0] = { x: 9, y: 9, pressure: 1, time: 2 };

  expect(stroke.config).toEqual({
    size: 12,
    hardness: 0.8,
    opacity: 0.7,
    flow: 0.6,
    spacing: 0.2,
    pressure: true,
    smoothing: 0.15,
  });
  expect(stroke.samples).toEqual([{ x: 1, y: 2, pressure: 0.5, time: 1 }]);

  for (const key of ["hardness", "opacity", "flow", "spacing", "smoothing"] as const) {
    expect(() =>
      createBrushStroke(
        mask,
        { ...config, [key]: -0.01 },
        [],
        `tx:invalid-${key}`,
      ),
    ).toThrow(`invalid brush ${key}`);
    expect(() =>
      createBrushStroke(
        mask,
        { ...config, [key]: 1.01 },
        [],
        `tx:invalid-${key}-high`,
      ),
    ).toThrow(`invalid brush ${key}`);
  }
  expect(() =>
    createBrushStroke(mask, { ...config, size: 0 }, [], "tx:invalid-size"),
  ).toThrow("invalid brush size");
});

test("mask controls are deterministic, transactional, and detached", () => {
  const inverted = invertMask(mask, "tx:invert");
  expect(inverted).toMatchObject({
    version: "brush-mask-v1",
    operation: "invert",
    maskId: "mask:one",
    transactionId: "tx:invert",
    mask: { maskId: "mask:one", inverted: true, enabled: true },
    deleted: false,
    applied: false,
  });
  expect(disableMask(mask, "tx:disable").mask?.enabled).toBe(false);
  expect(deleteMask(mask, "tx:delete")).toMatchObject({ deleted: true, mask: null });

  const first = duplicateMask(mask, "tx:duplicate");
  const replay = duplicateMask(mask, "tx:duplicate");
  expect(replay).toEqual(first);
  expect(first.mask).toMatchObject({
    maskId: "mask:one:duplicate:duplicate",
    thumbnailId: "thumb:one:duplicate:duplicate",
  });
  expect(first.mask).not.toBe(mask);
});

test("independent mask transforms are transactional, detached, and replay-stable", () => {
  const transform = [0.5, 0, 0, 0.5, 12, 18] as const;
  const first = transformMask(mask, transform, "tx:transform");
  const replay = transformMask(mask, transform, "tx:transform");

  expect(first).toEqual(replay);
  expect(first).toMatchObject({
    version: "brush-mask-v1",
    operation: "transform",
    maskId: mask.maskId,
    transactionId: "tx:transform",
    mask: { transform },
    deleted: false,
    applied: false,
  });
  expect(first.mask).not.toBe(mask);
  expect(first.mask?.transform).not.toBe(transform);
});

test("mask display modes are transactional, detached, and replay-stable", () => {
  for (const displayMode of ["overlay", "grayscale", "isolate"] as const) {
    const first = setMaskDisplayMode(mask, displayMode, `tx:${displayMode}`);
    const replay = setMaskDisplayMode(mask, displayMode, `tx:${displayMode}`);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      version: "brush-mask-v1",
      operation: "display-mode",
      maskId: mask.maskId,
      transactionId: `tx:${displayMode}`,
      mask: { displayMode },
      deleted: false,
      applied: false,
    });
    expect(first.mask).not.toBe(mask);
  }
});

test("mask display mode rejects unsupported values", () => {
  expect(() =>
    setMaskDisplayMode(mask, "unsupported" as never, "tx:display-mode"),
  ).toThrow("invalid brush mask display mode");
});

test("mask transform rejects non-finite or malformed matrices", () => {
  expect(() => transformMask(mask, [1, 0, 0, 1, Number.NaN, 0], "tx:bad")).toThrow(
    "invalid brush mask transform",
  );
  expect(() => transformMask(mask, [1, 0, 0, 1, 0] as never, "tx:bad")).toThrow(
    "invalid brush mask transform",
  );
});

test("mask apply fails loud until a pixel consumer is available", () => {
  expect(() => applyMask(mask, "tx:apply")).toThrow(BrushMaskCapabilityUnavailableError);
  expect(applyMask(mask, "tx:apply", true)).toMatchObject({
    operation: "apply",
    deleted: true,
    applied: true,
    mask: null,
  });
});
