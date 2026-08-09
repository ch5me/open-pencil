import { describe, expect, test } from "bun:test";

import {
  LAYER_MODEL_BLEND_MODES,
  LayerModelTransaction,
  LayerModelTransactionConflict,
  LayerModelMaskValidationError,
  LayerModelValidationError,
  isUnsupportedLayerMaskKind,
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
  }> = {},
) => ({
  id,
  parentId,
  childIds,
  type: overrides.type ?? "RECTANGLE",
  blendMode: overrides.blendMode ?? "NORMAL",
  maskId: overrides.maskId ?? null,
  maskKind: overrides.maskKind ?? null,
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
