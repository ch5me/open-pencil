import { expect, test } from "bun:test";

import {
  DEFAULT_PSD_LIMITS,
  createPsdCorpusManifest,
  layerMetadata,
  PsdHostileFileError,
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

test("rejects hostile PSD dimensions before staging", () => {
  expect(() => stagePsdExport({ width: 100_000, height: 20, layers: [] })).toThrow(
    PsdHostileFileError,
  );
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
