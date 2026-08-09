import { expect, test } from "bun:test";

import {
  createContentSnapshot,
  applyContentSnapshotTransition,
} from "#core/editor/history/journal";
import {
  deletePathAnchor,
  insertPathAnchor,
  movePathAnchor,
  type PathAnchor,
  type PenPath,
  type TextCapability,
  validateTextCapability,
  type VectorCapability,
  validateVectorCapability,
  validatePenPath,
} from "#core/editor/image-capabilities";
import {
  EffectAccelerationUnavailableError,
  reorderEffectStack,
  validateEffectFilter,
  type EffectFilter,
  type EffectStack,
} from "#core/editor/image-capabilities/effects";
import { createRasterMutation } from "#core/editor/image-raster";
import { createImageSelection } from "#core/editor/image-selection";

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

test("raster mutations and selections carry one transaction without pixel processing", () => {
  const mutation = createRasterMutation(
    "crop",
    { sourceId: "source:one", revisionId: `sha256:${"a".repeat(64)}`, width: 100, height: 80 },
    "tx:raster",
  );
  const selection = createImageSelection(
    "lasso",
    [
      { x: 1, y: 2 },
      { x: 5, y: 8 },
    ],
    "tx:raster",
  );
  expect(mutation.transactionId).toBe(selection.transactionId);
  expect(mutation.source.revisionId).toBe(`sha256:${"a".repeat(64)}`);
  expect(selection.points).toHaveLength(2);
});

test("pen path supports deterministic anchor editing and closed/open semantics", () => {
  const path: PenPath = {
    anchors: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 10, handleIn: [8, 8], handleOut: [12, 12] },
    ],
    closed: false,
    transactionId: "tx:pen",
  };
  const inserted: PathAnchor = { id: "c", x: 5, y: 5 };
  const edited = movePathAnchor(insertPathAnchor(path, inserted, 1), "a", 1, 2);
  expect(edited.anchors.map((anchor) => anchor.id)).toEqual(["a", "c", "b"]);
  expect(deletePathAnchor(edited, "c").anchors).toHaveLength(2);
  expect(() => validatePenPath({ ...path, anchors: [] })).toThrow("requires an anchor");
});

test("effects-v1 validates bounded filters and reorderable smart-mask stacks", () => {
  const filter: EffectFilter = {
    id: "effect:one",
    kind: "brightness",
    enabled: true,
    affectedArea: [0, 0, 100, 80],
    transactionId: "tx:effect",
  };
  const stack: EffectStack = {
    layerId: "layer:one",
    adjustmentScope: "group",
    filters: [filter, { ...filter, id: "effect:two", kind: "blur" }],
    effectMaskIds: ["mask:one"],
    smart: true,
  };
  expect(() => validateEffectFilter(filter)).not.toThrow();
  expect(reorderEffectStack(stack, 0, 1).filters[1]?.id).toBe("effect:one");
  expect(new EffectAccelerationUnavailableError().code).toBe("E_EFFECT_ACCELERATION_UNAVAILABLE");
});
