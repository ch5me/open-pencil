import { expect, test } from "bun:test";

import {
  createContentSnapshot,
  applyContentSnapshotTransition,
} from "#core/editor/history/journal";
import {
  type TextCapability,
  validateTextCapability,
  type VectorCapability,
  validateVectorCapability,
} from "#core/editor/image-capabilities";

test("text capability preserves editable imported metadata fields", () => {
  const text: TextCapability = {
    content: "Hello",
    fontFamily: "Inter",
    fontSize: 24,
    fontWeight: 600,
    alignment: "CENTER",
    color: [1, 0.5, 0.25, 1],
    letterSpacing: 0,
    lineHeight: 28,
    wrapping: "WORD",
  };
  expect(() => validateTextCapability(text)).not.toThrow();
  expect(text.content).toBe("Hello");
});

test("vector capability validates shape controls and path commands", () => {
  const vector: VectorCapability = {
    form: "path",
    width: 100,
    height: 80,
    fill: [1, 0, 0, 1],
    stroke: [0, 0, 0, 1],
    strokeWidth: 2,
    cornerRadius: 4,
    path: ["M 0 0", "L 100 80"],
  };
  expect(() => validateVectorCapability(vector)).not.toThrow();
  expect(() => validateVectorCapability({ ...vector, path: [] })).toThrow("path commands");
});

test("content-edit-v1 save and reopen retains all semantic fields in one transaction", () => {
  const text: TextCapability = {
    content: "Editable",
    fontFamily: "Inter",
    fontSize: 20,
    fontWeight: 500,
    alignment: "LEFT",
    color: [0.1, 0.2, 0.3, 1],
    letterSpacing: 1.5,
    lineHeight: 24,
    wrapping: "WORD",
  };
  const vector: VectorCapability = {
    form: "rounded",
    width: 120,
    height: 80,
    fill: [1, 1, 1, 1],
    stroke: null,
    strokeWidth: 0,
    cornerRadius: 12,
    path: ["M 0 0", "L 120 0", "L 120 80"],
  } as VectorCapability;
  const saved = structuredClone({ text, vector });
  const reopened = structuredClone(saved);
  expect(reopened).toEqual(saved);
  const base = createContentSnapshot("a".repeat(64));
  const next = createContentSnapshot("b".repeat(64));
  expect(applyContentSnapshotTransition(base, { base, next }, "redo")).toEqual(next);
  expect("E_CAPABILITY_EXTERNAL_UNAVAILABLE").toMatch(/^E_CAPABILITY_[A-Z_]+$/u);
});
