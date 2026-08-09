import { expect, test } from "bun:test";

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
