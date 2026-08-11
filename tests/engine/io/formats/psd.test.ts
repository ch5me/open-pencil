import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  DEFAULT_PSD_LIMITS,
  createPsdCorpusManifest,
  PsdCancelledError,
  layerMetadata,
  PsdHostileFileError,
  PsdUnsupportedError,
  type PsdCorpusCase,
  type PsdCorpusSource,
  type PsdExternalSource,
  PSD_CAPABILITY_WARNING_CONTRACT,
  parsePsdHeader,
  rasterizePsdLayers,
  readPsdFile,
  stagePsdExport,
  stagePsdImport,
  stagePsbExport,
  stagePsbImport,
} from "#core/io/formats/psd";
import externalCorpus from "#tests/fixtures/psd-corpus-v1/manifest.json";
import { expectDefined } from "#tests/helpers/assert";

const externalCorpusCases = externalCorpus.cases as readonly PsdCorpusCase[];
const externalCorpusSource = externalCorpus.source as PsdCorpusSource;
const externalCorpusSources = externalCorpus.externalSources as readonly PsdExternalSource[];

function stagedPsdWithMetadata(metadata: unknown): Uint8Array {
  const header = stagePsdExport({ width: 1, height: 1, layers: [] }).slice(0, 26);
  const marker = new TextEncoder().encode("OPPSD1");
  const payload = new TextEncoder().encode(JSON.stringify(metadata));
  const bytes = new Uint8Array(header.byteLength + marker.byteLength + payload.byteLength);
  bytes.set(header);
  bytes.set(marker, header.byteLength);
  bytes.set(payload, header.byteLength + marker.byteLength);
  return bytes;
}

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
  expect(reopened.layers).toEqual([layerMetadata("background", "Background")]);
  expect(reopened.warnings).toEqual([]);
  expect(reopened.degraded).toBe(false);
});

test("preserves PSD channels, spot colors, ICC profile, DPI, and document metadata", () => {
  const input = {
    width: 32,
    height: 16,
    layers: [layerMetadata("background", "Background")],
    channels: [
      { id: 0, name: "Cyan", kind: "color" as const },
      { id: 1, name: "Spot Gold", kind: "spot" as const, opacity: 0.75 },
      { id: -1, name: "Transparency", kind: "alpha" as const },
    ],
    colorMode: 4,
    bitsPerChannel: 16 as const,
    dpi: [300, 299.5] as const,
    iccProfile: { name: "Display P3", data: new Uint8Array([0, 1, 2, 255]) },
    spotColors: [{ name: "Gold", color: [0.8, 0.5, 0.1] as const, opacity: 0.9 }],
    metadata: { artist: "OpenPencil", proof: { version: 1 } },
  };
  const reopened = stagePsdImport(stagePsdExport(input));

  expect(reopened.header).toMatchObject({
    version: 1,
    channels: 3,
    height: 16,
    width: 32,
    bitsPerChannel: 16,
    colorMode: 4,
    dpi: [300, 299.5],
    channelsMetadata: input.channels,
    spotColors: input.spotColors,
    metadata: input.metadata,
  });
  expect(reopened.header.iccProfile).toEqual(input.iccProfile);
  expect(reopened.warnings).toEqual([]);
});

test("stages CMYK 16-bit PSD documents without typed degradation", () => {
  const bytes = stagePsdExport({
    width: 32,
    height: 16,
    layers: [layerMetadata("background", "Background")],
    channels: [
      { id: 0, name: "Cyan", kind: "color" },
      { id: 1, name: "Magenta", kind: "color" },
      { id: 2, name: "Yellow", kind: "color" },
      { id: 3, name: "Black", kind: "color" },
    ],
    colorMode: 4,
    bitsPerChannel: 16,
  });

  expect(stagePsdImport(bytes)).toMatchObject({
    header: { version: 1, colorMode: 4, bitsPerChannel: 16 },
    warnings: [],
    degraded: false,
  });
});

test("stages PSB version 2 with the same CMYK and 16-bit contract", () => {
  const bytes = stagePsbExport({
    width: 32,
    height: 16,
    layers: [layerMetadata("background", "Background")],
    colorMode: 4,
    bitsPerChannel: 16,
  });

  expect(stagePsbImport(bytes)).toMatchObject({
    header: { version: 2, colorMode: 4, bitsPerChannel: 16 },
    warnings: [],
    degraded: false,
  });
});

test("keeps document metadata export deterministic and caller-owned", () => {
  const input = {
    width: 32,
    height: 16,
    layers: [layerMetadata("background", "Background")],
    channels: [{ id: 0, name: "Alpha", kind: "alpha" as const }],
    colorMode: 3,
    bitsPerChannel: 8 as const,
    dpi: [144, 144] as const,
    iccProfile: { name: "sRGB", data: new Uint8Array([1, 2, 3]) },
    spotColors: [{ name: "Gold", color: [0.8, 0.5, 0.1] as const }],
    metadata: { nested: { revision: 1 } },
  };
  const before = structuredClone(input);
  const first = stagePsdExport(input);
  const second = stagePsdExport(input);
  const reopened = stagePsdImport(first);

  expect(first).toEqual(second);
  expect(input).toEqual(before);
  expect(reopened.header.iccProfile).toEqual(input.iccProfile);
  expect(reopened.header.metadata).toEqual(input.metadata);
});

test("validates typed document metadata and preserves bytes on rejection", () => {
  const cases = [
    { dpi: [300] },
    { channels: [{ id: 0, name: "bad", kind: "invalid" }] },
    { spotColors: [{ name: "bad", color: [2, 0, 0] }] },
    { metadata: [] },
  ];

  for (const metadata of cases) {
    const bytes = stagedPsdWithMetadata({ layers: [], ...metadata });
    const before = bytes.slice();
    expect(() => stagePsdImport(bytes)).toThrow(PsdUnsupportedError);
    expect(bytes).toEqual(before);
  }
});

test("keeps truly unsupported color mode and bit depth observable without mutating input", () => {
  const bytes = stagePsdExport({
    width: 4,
    height: 4,
    layers: [],
    colorMode: 4,
    bitsPerChannel: 16,
  });
  const view = new DataView(bytes.buffer);
  view.setUint16(22, 32, false);
  view.setUint16(24, 7, false);
  const before = bytes.slice();
  const result = stagePsdImport(bytes);

  expect(result.warnings).toEqual(["unsupported-color-mode", "unsupported-bit-depth"]);
  expect(result.degraded).toBe(true);
  expect(bytes).toEqual(before);
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

  expect(stagePsdImport(bytes).layers).toEqual([layerMetadata("text-1", "Headline", { text })]);
});

test("deterministically round-trips typed metadata without mutating caller data", () => {
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
  const layer = layerMetadata("text-1", "Headline", { text });
  const before = structuredClone(layer);
  const first = stagePsdExport({ width: 10, height: 20, layers: [layer] });
  const second = stagePsdExport({ width: 10, height: 20, layers: [layer] });

  expect(first).toEqual(second);
  expect(layer).toEqual(before);
  expect(stagePsdImport(first).layers).toEqual([layer]);
  expect(
    createPsdCorpusManifest(
      externalCorpusCases,
      externalCorpusSource,
      externalCorpusSources,
    ).cases.every(
      (entry) =>
        entry.externalReopen === "UNKNOWN" &&
        entry.semanticRoundTrip === "PASS" &&
        entry.byteRoundTrip === "UNKNOWN" &&
        entry.byteRoundTripSha256 === null,
    ),
  ).toBe(true);
});

test("preserves advanced PSD layer metadata and reports typed degradation", () => {
  const advanced = layerMetadata("hero", "Hero", {
    smartObjectId: "so:hero",
    smartObjectKind: "linked",
    linkedAssetId: "asset:hero",
    linkedAssetRevisionId: "rev:1",
    vector: {
      form: "path",
      width: 100,
      height: 80,
      path: ["M 0 0", "L 100 80"],
    },
    paths: [
      {
        id: "path:hero",
        anchors: [{ id: "a", x: 0, y: 0, handleOut: [10, 10] }],
        closed: false,
      },
    ],
    effects: [{ kind: "shadow", visible: true, blur: 4 }],
    vectorMask: {
      type: "VECTOR",
      density: 1,
      feather: 0,
      paths: [],
    },
  });
  const bytes = stagePsdExport({ width: 10, height: 20, layers: [advanced] });

  expect(stagePsdImport(bytes).layers).toEqual([advanced]);
  expect(stagePsdImport(bytes).warnings).toEqual(["unsupported-layer-feature"]);
  expect(stagePsdImport(bytes).degraded).toBe(true);
});

test("rasterizes visible text and shape layers with opacity and source-over order", () => {
  const redShape = new Uint8Array([255, 0, 0, 255]);
  const blueText = new Uint8Array([0, 0, 255, 255]);
  expect([
    ...rasterizePsdLayers({
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
    }),
  ]).toEqual([128, 0, 128, 255]);
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

test("failed PSD metadata import leaves caller bytes unchanged", () => {
  const bytes = stagePsdExport({
    width: 1,
    height: 1,
    layers: [layerMetadata("valid", "Valid")],
  });
  bytes.set(new TextEncoder().encode("OPPSD1{"), 26);
  const before = bytes.slice();

  expect(() => stagePsdImport(bytes)).toThrow("invalid PSD layer metadata");
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
  expect([
    ...rasterizePsdLayers({
      width: 1,
      height: 1,
      layers: [
        {
          ...layerMetadata("exposure", "Exposure", {
            adjustmentType: "exposure",
            adjustments: { exposure: 1 },
          }),
          raster: { width: 1, height: 1, pixels: new Uint8Array([32, 64, 96, 255]) },
        },
      ],
    }),
  ]).toEqual([64, 128, 192, 255]);
});

test("skips hidden layers and rejects malformed raster payloads", () => {
  expect([
    ...rasterizePsdLayers({
      width: 1,
      height: 1,
      layers: [
        {
          ...layerMetadata("hidden", "Hidden", { visible: false }),
          raster: { width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 255]) },
        },
      ],
    }),
  ]).toEqual([0, 0, 0, 0]);

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
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
  const mask = new Uint8Array([
    255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 255,
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
  expect([...rotated]).toEqual([0, 0, 0, 0, 255, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 0]);
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
  view.setUint16(22, 32, false);
  view.setUint16(24, 7, false);

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

test("psd-corpus-v1 verifies external fixture provenance and fail-loud reopen status", async () => {
  const firstExternalCase = expectDefined(externalCorpusCases[0], "first PSD corpus case");
  expect(() => createPsdCorpusManifest([], externalCorpusSource)).toThrow(
    "external corpus manifest is empty",
  );
  expect(() =>
    createPsdCorpusManifest(
      [{ ...firstExternalCase, warning: "unsupported-bit-depth" }],
      externalCorpusSource,
    ),
  ).toThrow("warning does not match capability");
  expect(() =>
    createPsdCorpusManifest([{ ...firstExternalCase, warning: "" }], externalCorpusSource),
  ).toThrow("warning coverage is incomplete");
  expect(() =>
    createPsdCorpusManifest(
      [{ ...firstExternalCase, sha256: "not-a-digest" }],
      externalCorpusSource,
    ),
  ).toThrow("lowercase SHA-256 digest");
  expect(() =>
    createPsdCorpusManifest(externalCorpusCases, { ...externalCorpusSource, ref: "main" }),
  ).toThrow("external corpus provenance is invalid");
  expect(() =>
    createPsdCorpusManifest(
      [
        {
          ...firstExternalCase,
          byteRoundTrip: "PASS",
          byteRoundTripSha256: "0000000000000000000000000000000000000000000000000000000000000000",
        },
        ...externalCorpusCases.slice(1),
      ],
      externalCorpusSource,
    ),
  ).toThrow("does not match source bytes");
  expect(() =>
    createPsdCorpusManifest(externalCorpusCases, externalCorpusSource, [
      {
        application: "photoshop",
        build: "UNKNOWN",
        fixture: null,
        sha256: null,
        externalReopen: "PASS",
        expected: {
          hierarchy: "PASS",
          appearance: "PASS",
          editability: "PASS",
        },
      },
      ...externalCorpusSources.slice(1),
    ]),
  ).toThrow("lacks external reopen provenance");
  const manifest = createPsdCorpusManifest(
    externalCorpusCases,
    externalCorpusSource,
    externalCorpusSources,
  );
  expect(manifest.version).toBe("psd-corpus-v1");
  expect(manifest.source).toEqual(externalCorpus.source);
  expect(Object.keys(PSD_CAPABILITY_WARNING_CONTRACT)).toHaveLength(16);
  expect(externalCorpus.externalSources.map((entry) => entry.application)).toEqual([
    "photoshop",
    "affinity",
    "krita",
    "photopea",
  ]);
  expect(
    externalCorpus.externalSources.every(
      (entry) =>
        entry.build === "UNKNOWN" &&
        entry.fixture === null &&
        entry.sha256 === null &&
        entry.externalReopen === "UNKNOWN" &&
        entry.expected.hierarchy === "UNKNOWN" &&
        entry.expected.appearance === "UNKNOWN" &&
        entry.expected.editability === "UNKNOWN",
    ),
  ).toBe(true);
  expect(manifest.cases.length).toBeGreaterThan(0);
  expect(manifest.warningContractCoverage).toBe(1);
  expect(manifest.externalWarningCoverage).toBe("UNKNOWN");
  expect(manifest.failedImportVisibleMutationCount).toBe(0);
  expect(manifest.cases.every((entry) => entry.externalReopen === "UNKNOWN")).toBe(true);
  for (const entry of manifest.cases) {
    const fixture = Bun.file(
      new URL(`../../../fixtures/psd-corpus-v1/${entry.fixture}`, import.meta.url),
    );
    const bytes = new Uint8Array(await fixture.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(26);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    const header = parsePsdHeader(bytes);
    expect(header.width).toBeGreaterThan(0);
    expect(header.height).toBeGreaterThan(0);
    const generatedLayer = layerMetadata(entry.name, entry.name);
    const generated = stagePsdExport({
      width: header.width,
      height: header.height,
      layers: [generatedLayer],
    });
    expect(generated.byteLength).toBeGreaterThan(26);
    const reopened = stagePsdImport(generated, {
      ...DEFAULT_PSD_LIMITS,
      maxExpansionRatio: Number.MAX_SAFE_INTEGER,
    });
    expect(reopened.header).toMatchObject({
      width: header.width,
      height: header.height,
    });
    expect(reopened.layers).toEqual([generatedLayer]);
    expect(entry.selfGeneratedRoundTrip).toBe("PASS");
    expect(createHash("sha256").update(generated).digest("hex")).toBe(
      entry.selfGeneratedRoundTripSha256,
    );
    expect(entry.semanticRoundTrip).toBe("PASS");
    expect(entry.byteRoundTrip).toBe("UNKNOWN");
    expect(entry.byteRoundTripSha256).toBeNull();
    expect(entry.source).toBe("external");
    expect(entry.expected.hierarchy).toBe("UNKNOWN");
    expect(entry.expected.appearance).toBe("UNKNOWN");
    expect(entry.expected.editability).toBe("UNKNOWN");
  }
});

test("rejects oversized PSD files before reading payload", async () => {
  let reads = 0;
  const file = {
    size: 101,
    arrayBuffer: async () => {
      reads += 1;
      return new ArrayBuffer(26);
    },
  } as File;

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
  } as File;

  await expect(readPsdFile(file, { ...DEFAULT_PSD_LIMITS, maxWidth: 9 })).rejects.toThrow(
    "PSD dimensions exceed limits",
  );
  expect(headerReads).toBe(1);
  expect(payloadReads).toBe(0);
});

test("rejects decoded PSD budgets after header read but before payload allocation", async () => {
  const header = stagePsdExport({ width: 10, height: 20, layers: [] });
  const cases = [
    {
      limits: { ...DEFAULT_PSD_LIMITS, maxDecodedBytes: 799 },
      message: "PSD decoded payload exceeds limits",
    },
    {
      limits: { ...DEFAULT_PSD_LIMITS, maxExpansionRatio: 1 },
      message: "PSD compressed expansion exceeds limits",
    },
  ];

  for (const { limits, message } of cases) {
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
    } as File;

    await expect(readPsdFile(file, limits)).rejects.toThrow(message);
    expect(headerReads).toBe(1);
    expect(payloadReads).toBe(0);
  }
});

test("pre-cancelled PSD import reads no header or payload bytes", async () => {
  const controller = new AbortController();
  let reads = 0;
  const file = {
    size: 26,
    slice: () => {
      reads += 1;
      return new Blob();
    },
    arrayBuffer: async () => {
      reads += 1;
      return new ArrayBuffer(26);
    },
  } as File;
  controller.abort();

  await expect(readPsdFile(file, DEFAULT_PSD_LIMITS, controller.signal)).rejects.toBeInstanceOf(
    PsdCancelledError,
  );
  expect(reads).toBe(0);
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
  } as File;

  const importPromise = readPsdFile(file, DEFAULT_PSD_LIMITS, controller.signal);
  await Promise.resolve();
  controller.abort();
  resolvePayload?.(bytes.buffer);

  await expect(importPromise).rejects.toBeInstanceOf(PsdCancelledError);
});
