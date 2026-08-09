import { describe, expect, test } from "bun:test";

import {
  AUTHORITY_MATRIX_HASH,
  IMAGE_EDITOR_CONTRACT,
  ImageEditorContractError,
  PATH_ALLOCATION_HASH,
  assertWaveOneDependency,
  canonicalContractJson,
  computeContractHash,
  validateImageEditorContract,
} from "#core/editor/image-contracts";

describe("image editor contracts", () => {
  test("matches the accepted current-authority artifacts", () => {
    expect(AUTHORITY_MATRIX_HASH).toBe(
      "7df61fa8d9fd23438bebbfa86aa053641c48e5f4e041449bb3baf9423d235e3e",
    );
    expect(PATH_ALLOCATION_HASH).toBe(
      "771c12edc26bda2cdac372b4f2494540c969e0b155abaa6cc976005ab36d014f",
    );
  });

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

    expect(() =>
      assertWaveOneDependency({
        authorityMatrixHash: AUTHORITY_MATRIX_HASH,
        pathAllocationHash: "0".repeat(64),
      }),
    ).toThrow("stale pathAllocationHash");
  });

  test("rejects malformed dependency digest shapes before authority checks", () => {
    expect(() =>
      assertWaveOneDependency({
        authorityMatrixHash: "A".repeat(64),
        pathAllocationHash: PATH_ALLOCATION_HASH,
      }),
    ).toThrow("authorityMatrixHash must be a lowercase SHA-256 hex digest");

    expect(() =>
      assertWaveOneDependency({
        authorityMatrixHash: AUTHORITY_MATRIX_HASH,
        pathAllocationHash: "f".repeat(63),
      }),
    ).toThrow("pathAllocationHash must be a lowercase SHA-256 hex digest");
  });

  test("validates the complete transaction and capability contract", () => {
    expect(() => validateImageEditorContract(IMAGE_EDITOR_CONTRACT)).not.toThrow();
    expect(IMAGE_EDITOR_CONTRACT.schema).toBe("ch5.open-pencil.image-editor.contract.v1");
    expect(IMAGE_EDITOR_CONTRACT.contractVersion).toBe("1.0.0");
    expect(IMAGE_EDITOR_CONTRACT.storage.contentCommitAtomic).toBe(true);
    expect(IMAGE_EDITOR_CONTRACT.composition.alpha).toBe("premultiplied");
    expect(IMAGE_EDITOR_CONTRACT.archive.durableCommitOwnedBy).toBe("host");
  });

  test("rejects contract drift in transaction fields", () => {
    expect(() =>
      validateImageEditorContract({
        ...IMAGE_EDITOR_CONTRACT,
        transaction: {
          ...IMAGE_EDITOR_CONTRACT.transaction,
          viewFields: [...IMAGE_EDITOR_CONTRACT.transaction.viewFields, "document"],
        },
      }),
    ).toThrow(ImageEditorContractError);
    expect(() =>
      validateImageEditorContract({
        ...IMAGE_EDITOR_CONTRACT,
        storage: { ...IMAGE_EDITOR_CONTRACT.storage, contentCommitAtomic: false },
      }),
    ).toThrow("invalid storage.contentCommitAtomic");
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

    const reversedCapabilities = {
      vectorMasks: true,
      independentMasks: true,
      linkedMasks: true,
      adjustmentMasks: true,
      groupMasks: true,
      declaredBlendModes: true,
      passThroughGroups: true,
    };
    const nestedKeysReordered = {
      ...IMAGE_EDITOR_CONTRACT,
      layerModel: {
        ...IMAGE_EDITOR_CONTRACT.layerModel,
        capabilities: reversedCapabilities,
      },
    };
    expect(canonicalContractJson()).toBe(canonicalContractJson(nestedKeysReordered));
    expect(await computeContractHash()).toBe(await computeContractHash(nestedKeysReordered));

    const arrayOrderChanged = {
      ...IMAGE_EDITOR_CONTRACT,
      transaction: {
        ...IMAGE_EDITOR_CONTRACT.transaction,
        contentFields: [...IMAGE_EDITOR_CONTRACT.transaction.contentFields].reverse(),
      },
    };
    expect(canonicalContractJson()).not.toBe(canonicalContractJson(arrayOrderChanged));
    expect(await computeContractHash()).not.toBe(await computeContractHash(arrayOrderChanged));
  });
});
