import { expect, test } from "bun:test";

import { AssetRegistry, type AssetId } from "#core/editor/assets";
import { ImageEditorStore } from "#core/editor/storage";

const revision = (index: number) => `sha256:${index.toString(16).padStart(64, "0")}` as const;

test("10,000 deterministic asset edits preserve references and duplicate independence", () => {
  let seed = 0x51f15e;
  const next = (max: number) => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed % max;
  };
  const registry = new AssetRegistry({
    assetId: (() => {
      let id = 0;
      return () => `asset:${id++}`;
    })(),
  });
  for (let index = 0; index < 32; index++) {
    registry.registerRevision({
      revisionId: revision(index),
      kind: "mask",
      metadata: { index },
      bytes: new Uint8Array([index]),
    });
  }
  const assets: AssetId[] = [registry.createAsset(revision(0)).assetId];
  let crossDuplicateWrites = 0;
  for (let operation = 0; operation < 10_000; operation++) {
    const choice = next(4);
    if (choice === 0 || assets.length === 0) {
      assets.push(registry.createAsset(revision(next(32))).assetId);
    } else if (choice === 1) {
      const index = next(assets.length);
      const source = registry.getAsset(assets[index]);
      const duplicate = registry.duplicateAsset(assets[index]);
      if (source?.assetId === duplicate.assetId) crossDuplicateWrites++;
      assets.push(duplicate.assetId);
    } else if (choice === 2) {
      const index = next(assets.length);
      registry.retargetAsset(assets[index], revision(next(32)));
    } else if (assets.length > 1) {
      const [removed] = assets.splice(next(assets.length), 1);
      if (!removed) throw new Error("randomized removal selected no asset");
      registry.deleteAsset(removed);
    }
    registry.assertConsistent();
  }
  expect(crossDuplicateWrites).toBe(0);
  expect(registry.reachableRevisionIds().size).toBeGreaterThan(0);
  expect(registry.snapshot().bindings.length).toBe(assets.length);
});

test("staged chunks can be discarded without changing committed head", () => {
  const store = new ImageEditorStore();
  store.setInitialHead("doc", { sequence: 1, contentRootHash: "a".repeat(64) });
  store.stageChunk({
    transactionId: "tx:cancel",
    chunkIndex: 0,
    offset: 0,
    byteLength: 1,
    sha256: "b".repeat(64),
    final: true,
    bytes: new Uint8Array([1]),
  });
  expect(store.stagedChunkCount("tx:cancel")).toBe(1);
  store.discardStaged("tx:cancel");
  expect(store.stagedChunkCount("tx:cancel")).toBe(0);
  expect(store.getHead("doc")?.sequence).toBe(1);
});
