import { describe, expect, test } from "bun:test";

import {
  LAYER_MODEL_BLEND_MODES,
  LayerModelTransaction,
  LayerModelTransactionConflict,
  LayerModelMaskValidationError,
  LayerModelValidationError,
  isUnsupportedLayerMaskKind,
  isUnsupportedLayerMaskType,
  isUnsupportedLayerColorLabel,
  isUnsupportedLayerBlendMode,
  migrateLayerModel,
} from "#core/editor/layer-model";
import type { BlendMode } from "#core/scene-graph";

const node = (
  id: string,
  parentId: string | null,
  childIds: string[] = [],
  overrides: Partial<{
    type: string;
    blendMode: BlendMode | string;
    maskId: string | null;
    maskKind: "group" | "adjustment-layer" | string | null;
    maskTransform: readonly [number, number, number, number, number, number] | null;
    maskTransformMode: "linked" | "independent" | string | null;
    maskType: "ALPHA" | "VECTOR" | "LUMINANCE" | string | null;
    maskDensity: number | null;
    maskFeather: number | null;
    edgeRefinement: {
      smooth?: number;
      feather?: number;
      contrast?: number;
      shiftEdge?: number;
    } | null;
    linkId: string | null;
    linkedLayerIds: readonly string[] | null;
    colorLabel: string | null;
  }> = {},
) => ({
  id,
  parentId,
  childIds,
  type: overrides.type ?? "RECTANGLE",
  blendMode: overrides.blendMode ?? "NORMAL",
  maskId: overrides.maskId ?? null,
  maskKind: overrides.maskKind ?? null,
    maskTransform: overrides.maskTransform ?? null,
    maskTransformMode: overrides.maskTransformMode ?? null,
    maskType: overrides.maskType ?? null,
    maskDensity: overrides.maskDensity ?? null,
    maskFeather: overrides.maskFeather ?? null,
    edgeRefinement: overrides.edgeRefinement ?? null,
    linkId: overrides.linkId ?? null,
    linkedLayerIds: overrides.linkedLayerIds ?? null,
    colorLabel: overrides.colorLabel ?? null,
});

describe("layer-model-v1", () => {
  test("migration is deterministic across clean Trees and preserves pass-through groups", async () => {
    const first = await migrateLayerModel([
      node("child", "group"),
      node("group", null, ["child"], { type: "GROUP", blendMode: "PASS_THROUGH" }),
    ]);
    const second = await migrateLayerModel([
      node("group", null, ["child"], { type: "GROUP", blendMode: "PASS_THROUGH" }),
      node("child", "group"),
    ]);

    expect(first.model.migrationHash).toBe(second.model.migrationHash);
    expect(first.model.nodes.get("group")?.passThrough).toBe(true);
    expect(first.cycles).toBe(0);
    expect(first.danglingRefs).toBe(0);
    expect(first.model.nodes.get("group")?.blendMode).toBe("PASS_THROUGH");
  });

  test("declares extended modes and preserves unsupported modes as typed values", async () => {
    expect(LAYER_MODEL_BLEND_MODES).toContain("OVERLAY");
    expect(LAYER_MODEL_BLEND_MODES).toContain("LUMINOSITY");

    const migrated = await migrateLayerModel([
      node("overlay", null, [], { blendMode: "OVERLAY" }),
      node("unknown", null, [], { blendMode: "VIVID_LIGHT" }),
    ]);
    expect(migrated.model.nodes.get("overlay")?.blendMode).toBe("OVERLAY");
    const unsupported = migrated.model.nodes.get("unknown")?.blendMode;
    expect(unsupported).toEqual({
      kind: "unsupported",
      code: "layer-model-unsupported-blend-mode",
      value: "VIVID_LIGHT",
    });
    expect(unsupported).toBeDefined();
    if (unsupported === undefined) throw new Error("missing migrated blend mode");
    expect(isUnsupportedLayerBlendMode(unsupported)).toBe(true);
  });

  test("only GROUP nodes interpret PASS_THROUGH as pass-through", async () => {
    const migrated = await migrateLayerModel([
      node("group", null, ["shape"], { type: "GROUP", blendMode: "PASS_THROUGH" }),
      node("shape", "group", [], { blendMode: "PASS_THROUGH" }),
    ]);

    expect(migrated.model.nodes.get("group")?.passThrough).toBe(true);
    expect(migrated.model.nodes.get("shape")?.passThrough).toBe(false);
  });

  test("models group and adjustment-layer masks with typed unsupported kinds", async () => {
    const migrated = await migrateLayerModel([
      node("group-mask", null, [], { maskId: "content", maskKind: "group" }),
      node("adjustment-mask", null, [], { maskId: "content", maskKind: "adjustment-layer" }),
      node("content", null),
      node("future-mask", null, [], { maskId: "content", maskKind: "luminosity" }),
    ]);

    expect(migrated.model.nodes.get("group-mask")).toMatchObject({
      maskKind: "group",
      groupMask: true,
      adjustmentLayerMask: false,
    });
    expect(migrated.model.nodes.get("adjustment-mask")).toMatchObject({
      maskKind: "adjustment-layer",
      groupMask: false,
      adjustmentLayerMask: true,
    });
    const unsupported = migrated.model.nodes.get("future-mask")?.maskKind;
    expect(unsupported).toEqual({
      kind: "unsupported",
      code: "layer-model-unsupported-mask-kind",
      value: "luminosity",
    });
    expect(unsupported).toBeDefined();
    if (unsupported === null || unsupported === undefined) throw new Error("missing mask kind");
    expect(isUnsupportedLayerMaskKind(unsupported)).toBe(true);
  });

  test("supports linked masks and independently transformed masks", async () => {
    const transform = [1, 0, 12, 0, 1, -8] as const;
    const migrated = await migrateLayerModel([
      node("linked-a", null, [], { maskId: "shared", maskKind: "group" }),
      node("linked-b", null, [], { maskId: "shared", maskKind: "group" }),
      node("independent", null, [], {
        maskId: "shared",
        maskKind: "adjustment-layer",
        maskTransform: transform,
        maskTransformMode: "independent",
      }),
      node("shared", null),
    ]);

    expect(migrated.model.nodes.get("linked-a")).toMatchObject({
      maskId: "shared",
      maskTransform: null,
      maskTransformMode: "linked",
    });
    expect(migrated.model.nodes.get("linked-b")?.maskId).toBe("shared");
    expect(migrated.model.nodes.get("independent")).toMatchObject({
      maskTransform: transform,
      maskTransformMode: "independent",
    });
    expect(migrated.model.nodes.get("independent")?.maskTransform).not.toBe(transform);
  });

  test("supports linked layer editing and color labels with typed future values", async () => {
    const migrated = await migrateLayerModel([
      node("base", null, [], { linkId: "hero", colorLabel: "BLUE" }),
      node("copy", null, [], { linkId: "hero", linkedLayerIds: ["base"], colorLabel: "MAGENTA" }),
    ]);
    expect(migrated.model.nodes.get("base")).toMatchObject({
      linkId: "hero",
      colorLabel: "BLUE",
    });
    expect(migrated.model.nodes.get("copy")).toMatchObject({
      linkId: "hero",
      linkedLayerIds: ["base"],
    });
    const label = migrated.model.nodes.get("copy")?.colorLabel;
    expect(label).toEqual({
      kind: "unsupported",
      code: "layer-model-unsupported-color-label",
      value: "MAGENTA",
    });
    if (label === null || label === undefined) throw new Error("missing color label");
    expect(isUnsupportedLayerColorLabel(label)).toBe(true);
  });

  test("rejects dangling and self-linked layers", async () => {
    await expect(
      migrateLayerModel([node("a", null, [], { linkedLayerIds: ["missing"] })]),
    ).rejects.toThrow("dangling linked layer reference");
    await expect(
      migrateLayerModel([node("a", null, [], { linkedLayerIds: ["a"] })]),
    ).rejects.toThrow("self-referencing layer link");
  });

  test("models density, feather, edge refinement, and vector masks", async () => {
    const migrated = await migrateLayerModel([
      node("vector", null, [], {
        maskId: "source",
        maskKind: "group",
        maskType: "VECTOR",
        maskDensity: 0.75,
        maskFeather: 12,
        edgeRefinement: { smooth: 20, feather: 4, contrast: -10, shiftEdge: 8 },
      }),
      node("source", null),
    ]);
    expect(migrated.model.nodes.get("vector")).toMatchObject({
      maskType: "VECTOR",
      vectorMask: true,
      maskDensity: 0.75,
      maskFeather: 12,
      edgeRefinement: { smooth: 20, feather: 4, contrast: -10, shiftEdge: 8 },
    });
  });

  test("keeps unsupported vector mask types typed and rejects invalid refinements", async () => {
    const migrated = await migrateLayerModel([
      node("future", null, [], { maskId: "source", maskType: "PATH" }),
      node("source", null),
    ]);
    const maskType = migrated.model.nodes.get("future")?.maskType;
    expect(maskType).toEqual({
      kind: "unsupported",
      code: "layer-model-unsupported-mask-type",
      value: "PATH",
    });
    if (maskType === null || maskType === undefined) throw new Error("missing mask type");
    expect(isUnsupportedLayerMaskType(maskType)).toBe(true);
    await expect(
      migrateLayerModel([
        node("invalid", null, [], { maskId: "source", maskDensity: 2 }),
        node("source", null),
      ]),
    ).rejects.toThrow("invalid mask density");
    await expect(
      migrateLayerModel([
        node("invalid", null, [], {
          maskId: "source",
          edgeRefinement: { contrast: 101 },
        }),
        node("source", null),
      ]),
    ).rejects.toThrow("invalid edge refinement");
  });

  test("rejects cycles and dangling parent, child, and mask references", async () => {
    await expect(migrateLayerModel([node("a", "b", ["b"]), node("b", "a", ["a"])])).rejects.toThrow(
      LayerModelValidationError,
    );
    await expect(migrateLayerModel([node("a", null, ["missing"])])).rejects.toThrow(
      "dangling child reference",
    );
    await expect(migrateLayerModel([node("a", null, [], { maskId: "missing" })])).rejects.toThrow(
      "dangling mask reference",
    );
    await expect(
      migrateLayerModel([node("a", null, [], { maskKind: "group" })]),
    ).rejects.toThrow(LayerModelMaskValidationError);
    await expect(
      migrateLayerModel([node("a", null, [], { maskId: "a", maskKind: "group" })]),
    ).rejects.toThrow("self-referencing mask");
    await expect(
      migrateLayerModel([
        node("a", null, [], { maskId: "b", maskKind: "group" }),
        node("b", null, [], { maskId: "a", maskKind: "group" }),
      ]),
    ).rejects.toThrow("cyclic mask reference");
    await expect(
      migrateLayerModel([
        node("a", null, [], { maskId: "b", maskKind: "group", maskTransformMode: "independent" }),
        node("b", null),
      ]),
    ).rejects.toThrow("requires transform");
    await expect(
      migrateLayerModel([
        node("a", null, [], {
          maskId: "b",
          maskKind: "group",
          maskTransform: [1, 0, Number.NaN, 0, 1, 0],
        }),
        node("b", null),
      ]),
    ).rejects.toThrow("invalid mask transform");
  });

  test("isolates invalidation to changed layers and commits old-or-new atomically", async () => {
    const initial = await migrateLayerModel([
      node("a", null, [], { maskId: "b", maskKind: "group" }),
      node("b", null),
    ]);
    const transaction = new LayerModelTransaction(initial.model);
    const committed = await transaction.commit(initial.model.migrationHash, [
      node("a", null, [], { blendMode: "MULTIPLY", maskId: "b", maskKind: "adjustment-layer" }),
      node("b", null),
    ]);
    expect(committed.invalidatedNodeIds).toEqual(["a"]);

    const committedHash = transaction.model.migrationHash;
    await expect(transaction.commit(committedHash, [node("a", null, ["missing"])])).rejects.toThrow(
      LayerModelValidationError,
    );
    expect(transaction.model.migrationHash).toBe(committedHash);
    await expect(
      transaction.commit(initial.model.migrationHash, [node("a", null)]),
    ).rejects.toThrow(LayerModelTransactionConflict);
  });
});
