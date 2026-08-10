import { expect, test } from "bun:test";

import {
  DEFAULT_PSD_LIMITS,
  createPsdCorpusManifest,
  PsdCancelledError,
  layerMetadata,
  PsdHostileFileError,
  PsdUnsupportedError,
  parsePsdHeader,
  rasterizePsdLayers,
  readPsdFile,
  stagePsdExport,
  stagePsdImport,
} from "#core/io/formats/psd";

test("stages PSD import without mutating caller state and reports typed warnings", () => {
  const bytes = stagePsdExport({
    width: 10,
    height: 20,
    layers: [layerMetadata("1", "Background")],
  });
  const before = bytes.slice();
  const result = stagePsdImport(bytes);
  expect(result.staged).toBe(true);
  expect(result.header.width).toBe(10);
  expect(result.header.height).toBe(20);
  expect(bytes).toEqual(before);
});

test("reopens the staged PSD export with stable interchange header fields", () => {
  const bytes = stagePsdExport({
    width: 10,
    height: 20,
    layers: [layerMetadata("background", "Background")],
  });

  const reopened = stagePsdImport(bytes);
  expect(reopened.header).toEqual({
    version: 1,
    channels: 4,
    height: 20,
    width: 10,
    bitsPerChannel: 8,
    colorMode: 3,
  });
  expect(reopened.layers).toEqual([
    layerMetadata("background", "Background"),
  ]);
  expect(reopened.warnings).toEqual([]);
  expect(reopened.degraded).toBe(false);
});

test("preserves editable PSD text-layer metadata through producer staging", () => {
  const text = {
    sourceId: "text-1",
    editable: true,
    originalContent: "Hello PSD",
    content: "Hello PSD",
    fontFamily: "Inter",
    fontSize: 24,
    fontWeight: 400,
    alignment: "LEFT" as const,
    color: [0, 0, 0, 1] as const,
    letterSpacing: 0,
    lineHeight: 28,
    wrapping: "WORD" as const,
  };
  const bytes = stagePsdExport({
    width: 10,
    height: 20,
    layers: [layerMetadata("text-1", "Headline", { text })],
  });

  expect(stagePsdImport(bytes).layers).toEqual([
    layerMetadata("text-1", "Headline", { text }),
  ]);
});

test("rasterizes visible text and shape layers with opacity and source-over order", () => {
  const redShape = new Uint8Array([255, 0, 0, 255]);
  const blueText = new Uint8Array([0, 0, 255, 255]);
  expect(
    [...rasterizePsdLayers({
      width: 1,
      height: 1,
      layers: [
        {
          ...layerMetadata("shape", "Shape"),
          raster: { width: 1, height: 1, pixels: redShape },
        },
        {
          ...layerMetadata("text", "Text", { opacity: 0.5 }),
          raster: { width: 1, height: 1, pixels: blueText },
        },
      ],
    })],
  ).toEqual([128, 0, 128, 255]);
});

test("rasterizes supported PSD blend modes and rejects unsupported modes", () => {
  const red = new Uint8Array([255, 0, 0, 255]);
  const blue = new Uint8Array([0, 0, 255, 255]);
  const blended = rasterizePsdLayers({
    width: 1,
    height: 1,
    layers: [
      { ...layerMetadata("base", "Base"), raster: { width: 1, height: 1, pixels: red } },
      {
        ...layerMetadata("screen", "Screen", { blendMode: "SCREEN" }),
        raster: { width: 1, height: 1, pixels: blue },
      },
    ],
  });
  expect([...blended]).toEqual([255, 0, 255, 255]);

  expect(() =>
    rasterizePsdLayers({
      width: 1,
      height: 1,
      layers: [
        {
          ...layerMetadata("unsupported", "Unsupported", { blendMode: "COLOR_DODGE" }),
          raster: { width: 1, height: 1, pixels: blue },
        },
      ],
    }),
  ).toThrow("unsupported PSD blend mode: COLOR_DODGE");
});

test("reports unsupported PSD blend modes without mutating staged bytes", () => {
  const bytes = stagePsdExport({
    width: 1,
    height: 1,
    layers: [layerMetadata("unsupported", "Unsupported", { blendMode: "COLOR_DODGE" })],
  });
  const before = bytes.slice();
  const result = stagePsdImport(bytes);
  expect(result.warnings).toEqual(["unsupported-blend-mode"]);
  expect(result.degraded).toBe(true);
  expect(bytes).toEqual(before);
});

test("preserves supported adjustment metadata and warns on unsupported types", () => {
  const supported = layerMetadata("levels", "Levels", {
    adjustmentType: "levels",
    adjustments: { inputBlack: 8, inputWhite: 240 },
  });
  const unsupported = layerMetadata("lookup", "Lookup", {
    adjustmentType: "lookup",
    adjustments: { amount: 0.5 },
  });
  const bytes = stagePsdExport({ width: 1, height: 1, layers: [supported, unsupported] });
  const before = bytes.slice();
  const result = stagePsdImport(bytes);

  expect(result.layers).toEqual([supported, unsupported]);
  expect(result.warnings).toEqual(["unsupported-layer-feature"]);
  expect(result.degraded).toBe(true);
  expect(bytes).toEqual(before);
});

test("rejects unsupported PSD adjustment types before raster mutation", () => {
  const pixels = new Uint8Array([255, 0, 0, 255]);
  expect(() =>
    rasterizePsdLayers({
      width: 1,
      height: 1,
      layers: [
        {
          ...layerMetadata("unsupported", "Unsupported", { adjustmentType: "lookup" }),
          raster: { width: 1, height: 1, pixels },
        },
      ],
    }),
  ).toThrow("unsupported PSD adjustment type: lookup");
});

test("applies supported PSD adjustment metadata during rasterization", () => {
  expect(
    [...rasterizePsdLayers({
      width: 1,
      height: 1,
      layers: [{
        ...layerMetadata("exposure", "Exposure", {
          adjustmentType: "exposure",
          adjustments: { exposure: 1 },
        }),
        raster: { width: 1, height: 1, pixels: new Uint8Array([32, 64, 96, 255]) },
      }],
    })],
  ).toEqual([64, 128, 192, 255]);
});

test("skips hidden layers and rejects malformed raster payloads", () => {
  expect(
    [...rasterizePsdLayers({
      width: 1,
      height: 1,
      layers: [
        {
          ...layerMetadata("hidden", "Hidden", { visible: false }),
          raster: { width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 255]) },
        },
      ],
    })],
  ).toEqual([0, 0, 0, 0]);

  expect(() =>
    rasterizePsdLayers({
      width: 1,
      height: 1,
      layers: [
        {
          ...layerMetadata("bad", "Bad"),
          raster: { width: 2, height: 1, pixels: new Uint8Array(8) },
        },
      ],
    }),
  ).toThrow("raster layer dimensions do not match document");
});

test("preserves rotated raster layers and applies rotated alpha masks", () => {
  const pixels = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 0, 255,
  ]);
  const mask = new Uint8Array([
    255, 255, 255, 255,
    255, 255, 255, 0,
    255, 255, 255, 0,
    255, 255, 255, 255,
  ]);
  const rotated = rasterizePsdLayers({
    width: 2,
    height: 2,
    layers: [
      {
        ...layerMetadata("rotated", "Rotated"),
        raster: {
          width: 2,
          height: 2,
          pixels,
          rotation: 90,
          mask: { width: 2, height: 2, pixels: mask, rotation: 90 },
        },
      },
    ],
  });
  expect([...rotated]).toEqual([
    0, 0, 0, 0,
    255, 0, 0, 255,
    255, 255, 0, 255,
    0, 0, 0, 0,
  ]);
});

test("rejects malformed rotated raster and mask transforms", () => {
  const layer = {
    ...layerMetadata("bad-transform", "Bad transform"),
    raster: {
      width: 1,
      height: 1,
      pixels: new Uint8Array([255, 0, 0, 255]),
      transform: [Number.NaN, 0, 0, 1, 0, 0] as const,
    },
  };
  expect(() => rasterizePsdLayers({ width: 1, height: 1, layers: [layer] })).toThrow(
    "raster transform is invalid",
  );
  expect(() =>
    rasterizePsdLayers({
      width: 1,
      height: 1,
      layers: [
        {
          ...layerMetadata("bad-mask", "Bad mask"),
          raster: {
            width: 1,
            height: 1,
            pixels: new Uint8Array([255, 0, 0, 255]),
            mask: { width: 2, height: 1, pixels: new Uint8Array(8) },
          },
        },
      ],
    }),
  ).toThrow("raster layer dimensions do not match document");
});

test("keeps PSD export deterministic and leaves layer input unchanged", () => {
  const layers = [layerMetadata("layer-1", "Layer", { opacity: 0.5 })];
  const before = structuredClone(layers);

  const first = stagePsdExport({ width: 10, height: 20, layers });
  const second = stagePsdExport({ width: 10, height: 20, layers });

  expect(first).toEqual(second);
  expect(layers).toEqual(before);
  expect(stagePsdImport(first).layers).toEqual(before);
});

test("rejects hostile PSD dimensions before staging", () => {
  expect(() => stagePsdExport({ width: 100_000, height: 20, layers: [] })).toThrow(
    PsdHostileFileError,
  );
});

test("rejects non-integral and non-finite export dimensions", () => {
  for (const width of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => stagePsdExport({ width, height: 20, layers: [] })).toThrow(PsdHostileFileError);
  }
});

test("rejects malformed PSD headers with typed errors", () => {
  expect(() => parsePsdHeader(new Uint8Array(25))).toThrow(PsdUnsupportedError);

  const invalidSignature = stagePsdExport({ width: 10, height: 20, layers: [] });
  invalidSignature[0] = 0;
  expect(() => parsePsdHeader(invalidSignature)).toThrow("invalid PSD signature");

  const invalidVersion = stagePsdExport({ width: 10, height: 20, layers: [] });
  new DataView(invalidVersion.buffer).setUint16(4, 3, false);
  expect(() => parsePsdHeader(invalidVersion)).toThrow("unsupported PSD version: 3");

  const noChannels = stagePsdExport({ width: 10, height: 20, layers: [] });
  new DataView(noChannels.buffer).setUint16(12, 0, false);
  expect(() => parsePsdHeader(noChannels)).toThrow("PSD has no channels");
});

test("reports degraded import for unsupported header properties", () => {
  const bytes = stagePsdExport({ width: 10, height: 20, layers: [] });
  const view = new DataView(bytes.buffer);
  view.setUint16(22, 16, false);
  view.setUint16(24, 4, false);

  const result = stagePsdImport(bytes);
  expect(result.degraded).toBe(true);
  expect(result.warnings).toEqual(["unsupported-color-mode", "unsupported-bit-depth"]);
});

test("rejects decoded payload expansion before allocation", () => {
  const bytes = stagePsdExport({ width: 10, height: 20, layers: [] });
  expect(() =>
    stagePsdImport(bytes, {
      ...DEFAULT_PSD_LIMITS,
      maxDecodedBytes: 100,
    }),
  ).toThrow("decoded payload exceeds limits");
});

test("rejects compressed expansion and render-buffer budgets", () => {
  const bytes = stagePsdExport({ width: 10, height: 20, layers: [] });
  expect(() => stagePsdImport(bytes, { ...DEFAULT_PSD_LIMITS, maxExpansionRatio: 1 })).toThrow(
    "compressed expansion exceeds limits",
  );
  expect(() => stagePsdImport(bytes, { ...DEFAULT_PSD_LIMITS, maxRenderBytes: 100 })).toThrow(
    "render buffer exceeds limits",
  );
});

test("psd-corpus-v1 covers capabilities with fail-loud external reopen status", () => {
  const manifest = createPsdCorpusManifest();
  expect(manifest.version).toBe("psd-corpus-v1");
  expect(manifest.cases).toHaveLength(16);
  expect(new Set(manifest.cases.map((entry) => entry.capability)).size).toBe(16);
  expect(manifest.warningCoverage).toBe(1);
  expect(manifest.failedImportVisibleMutationCount).toBe(0);
  expect(manifest.cases.every((entry) => entry.externalReopen === "UNKNOWN")).toBe(true);
});

test("rejects oversized PSD files before reading payload", async () => {
  let reads = 0;
  const file = {
    size: 101,
    arrayBuffer: async () => {
      reads += 1;
      return new ArrayBuffer(26);
    },
  } as unknown as File;

  await expect(readPsdFile(file, { ...DEFAULT_PSD_LIMITS, maxBytes: 100 })).rejects.toThrow(
    "PSD exceeds byte limit",
  );
  expect(reads).toBe(0);
});

test("rejects decoded dimensions after header read but before payload allocation", async () => {
  const header = stagePsdExport({ width: 10, height: 20, layers: [] });
  let headerReads = 0;
  let payloadReads = 0;
  const file = {
    size: header.byteLength,
    slice: () => ({
      arrayBuffer: async () => {
        headerReads += 1;
        return header.buffer;
      },
    }),
    arrayBuffer: async () => {
      payloadReads += 1;
      return header.buffer;
    },
  } as unknown as File;

  await expect(
    readPsdFile(file, { ...DEFAULT_PSD_LIMITS, maxWidth: 9 }),
  ).rejects.toThrow("PSD dimensions exceed limits");
  expect(headerReads).toBe(1);
  expect(payloadReads).toBe(0);
});

test("cancellation tombstone prevents a post-cancel PSD publish", async () => {
  const bytes = stagePsdExport({ width: 10, height: 20, layers: [] });
  const controller = new AbortController();
  let resolvePayload: ((buffer: ArrayBuffer) => void) | undefined;
  const file = {
    size: bytes.byteLength,
    slice: () => ({
      arrayBuffer: async () => bytes.buffer,
    }),
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((resolve) => {
        resolvePayload = resolve;
      }),
  } as unknown as File;

  const importPromise = readPsdFile(file, DEFAULT_PSD_LIMITS, controller.signal);
  await Promise.resolve();
  controller.abort();
  resolvePayload?.(bytes.buffer);

  await expect(importPromise).rejects.toBeInstanceOf(PsdCancelledError);
});
