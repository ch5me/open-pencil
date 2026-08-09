import { describe, expect, test } from "bun:test";

import {
  AUTHORITY_MATRIX_HASH,
  IMAGE_EDITOR_CONTRACT,
  PATH_ALLOCATION_HASH,
  assertWaveOneDependency,
  canonicalContractJson,
  computeContractHash,
} from "#core/editor/image-contracts";

describe("image editor contracts", () => {
  test("accepts the approved Wave 1 dependency receipt", () => {
    expect(() =>
      assertWaveOneDependency({
        authorityMatrixHash: AUTHORITY_MATRIX_HASH,
        pathAllocationHash: PATH_ALLOCATION_HASH,
      }),
    ).not.toThrow();
  });

  test("rejects stale dependency hashes", () => {
    expect(() =>
      assertWaveOneDependency({
        authorityMatrixHash: "0".repeat(64),
        pathAllocationHash: PATH_ALLOCATION_HASH,
      }),
    ).toThrow("stale authorityMatrixHash");
  });

  test("separates content and view versions", () => {
    expect(IMAGE_EDITOR_CONTRACT.transaction.contentFields).not.toContain("pan");
    expect(IMAGE_EDITOR_CONTRACT.transaction.viewFields).toContain("pan");
    expect(IMAGE_EDITOR_CONTRACT.transaction.viewChangesAffectContent).toBe(false);
  });

  test("declares deterministic layer-model-v1 authority semantics", () => {
    expect(IMAGE_EDITOR_CONTRACT.layerModel.version).toBe("layer-model-v1");
    expect(IMAGE_EDITOR_CONTRACT.layerModel.invariants).toEqual([
      "acyclic-parent-links",
      "no-dangling-mask-links",
      "stable-layer-order",
    ]);
    expect(IMAGE_EDITOR_CONTRACT.layerModel.multiLayerTransaction).toBe("old-or-new");
    expect(IMAGE_EDITOR_CONTRACT.layerModel.capabilities.vectorMasks).toBe(true);
    expect(IMAGE_EDITOR_CONTRACT.layerModel.unsupportedFields).toContain("layer-link-color-label");
  });

  test("canonicalizes and hashes deterministically", async () => {
    const reordered = {
      ...IMAGE_EDITOR_CONTRACT,
      storage: { ...IMAGE_EDITOR_CONTRACT.storage },
    };
    expect(canonicalContractJson()).toBe(canonicalContractJson(reordered));
    expect(await computeContractHash()).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(await computeContractHash()).toBe(await computeContractHash(reordered));
    const cleanTreeFixture = structuredClone(IMAGE_EDITOR_CONTRACT);
    const cleanTreeFixtureReordered = {
      ...cleanTreeFixture,
      layerModel: {
        ...cleanTreeFixture.layerModel,
        capabilities: { ...cleanTreeFixture.layerModel.capabilities },
      },
    };
    expect(await computeContractHash(cleanTreeFixture)).toBe(
      await computeContractHash(cleanTreeFixtureReordered),
    );
  });
});
