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

  test("canonicalizes and hashes deterministically", async () => {
    const reordered = {
      ...IMAGE_EDITOR_CONTRACT,
      storage: { ...IMAGE_EDITOR_CONTRACT.storage },
    };
    expect(canonicalContractJson()).toBe(canonicalContractJson(reordered));
    expect(await computeContractHash()).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(await computeContractHash()).toBe(await computeContractHash(reordered));
  });
});
