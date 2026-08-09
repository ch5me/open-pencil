import { expect, test } from "bun:test";

import {
  DEFAULT_PSD_LIMITS,
  createPsdCorpusManifest,
  PsdCancelledError,
  layerMetadata,
  PsdHostileFileError,
  PsdUnsupportedError,
  parsePsdHeader,
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
  expect(reopened.layers).toEqual([]);
  expect(reopened.warnings).toEqual([]);
  expect(reopened.degraded).toBe(false);
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
