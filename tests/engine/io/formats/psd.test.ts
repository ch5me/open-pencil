import { expect, test } from "bun:test";

import {
  DEFAULT_PSD_LIMITS,
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
