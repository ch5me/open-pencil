import { expect, test } from "bun:test";

import { AssetRegistry, type AssetId } from "#core/editor/assets";

const revision = (name: string) => `sha256:${name.repeat(64 / name.length)}` as const;

test("asset duplication and retargeting keep references isolated", () => {
  const registry = new AssetRegistry({
    assetId: (() => {
      let index = 0;
      return () => `asset:gap005-${index++}`;
    })(),
  });
  const firstRevision = revision("a");
  const secondRevision = revision("b");
  registry.registerRevision({
    revisionId: firstRevision,
    kind: "image",
    metadata: { source: "first" },
    bytes: new Uint8Array([1]),
  });
  registry.registerRevision({
    revisionId: secondRevision,
    kind: "image",
    metadata: { source: "second" },
    bytes: new Uint8Array([2]),
  });

  const source = registry.createAsset(firstRevision);
  const duplicate = registry.duplicateAsset(source.assetId);
  registry.retargetAsset(duplicate.assetId, secondRevision);

  const danglingRefs = [source.assetId, duplicate.assetId].filter(
    (assetId) => !registry.getAsset(assetId),
  ).length;
  const crossDuplicateWrites = Number(source.assetId === duplicate.assetId);
  const unreachableAssets = registry
    .snapshot()
    .bindings.filter(({ assetId }) => ![source.assetId, duplicate.assetId].includes(assetId)).length;

  expect({ danglingRefs, crossDuplicateWrites, unreachableAssets }).toEqual({
    danglingRefs: 0,
    crossDuplicateWrites: 0,
    unreachableAssets: 0,
  });
  expect(registry.getAsset(source.assetId)?.revisionId).toBe(firstRevision);
  expect(registry.getAsset(duplicate.assetId)?.revisionId).toBe(secondRevision);
  registry.validateReferences([source.assetId, duplicate.assetId]);
  registry.assertConsistent();
});

test("garbage collection releases only unreachable revisions", () => {
  const registry = new AssetRegistry({
    assetId: (() => {
      let index = 0;
      return () => `asset:gap005-gc-${index++}`;
    })(),
  });
  const retainedRevision = revision("c");
  const pinnedRevision = revision("d");
  const unreachableRevision = revision("e");
  for (const [revisionId, byte] of [
    [retainedRevision, 1],
    [pinnedRevision, 2],
    [unreachableRevision, 3],
  ] as const) {
    registry.registerRevision({
      revisionId,
      kind: "mask",
      metadata: {},
      bytes: new Uint8Array([byte]),
    });
  }

  const retained = registry.createAsset(retainedRevision);
  const deleted = registry.createAsset(unreachableRevision);
  registry.deleteAsset(deleted.assetId);

  const danglingRefs = [retained.assetId].filter((assetId) => !registry.getAsset(assetId)).length;
  const unreachableAssets = registry
    .snapshot()
    .revisions.filter(({ revisionId }) => revisionId === unreachableRevision).length;
  const gc = registry.collectGarbage([pinnedRevision]);

  expect(danglingRefs).toBe(0);
  expect(unreachableAssets).toBe(1);
  expect(gc).toEqual({
    releasedRevisionIds: [unreachableRevision],
    releasedBytes: 1,
  });
  expect(registry.getRevision(retainedRevision)).toBeDefined();
  expect(registry.getRevision(pinnedRevision)).toBeDefined();
  expect(registry.getRevision(unreachableRevision)).toBeUndefined();
  registry.validateReferences([retained.assetId]);
});

test("missing asset references fail loud", () => {
  const registry = new AssetRegistry();
  const missingAsset = "asset:gap005-missing" as AssetId;

  expect(() => registry.validateReferences([missingAsset])).toThrow(
    `missing asset binding: ${missingAsset}`,
  );
});
