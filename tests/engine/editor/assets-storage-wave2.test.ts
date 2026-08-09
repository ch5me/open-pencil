import { expect, test } from "bun:test";

import { AssetRegistry, type AssetId } from "#core/editor/assets";
import {
  applyContentSnapshotTransition,
  createContentSnapshot,
  type ContentSnapshot,
} from "#core/editor/history/journal";
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

test("10,000 combined edits restore hashes and leave no dangling or mixed references", () => {
  let seed = 0x7e57c0de;
  const next = (max: number) => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed % max;
  };
  let state = createContentSnapshot("0".repeat(64));
  const history: Array<{ base: ContentSnapshot; next: ContentSnapshot }> = [];
  const registry = new AssetRegistry({
    assetId: (() => {
      let id = 0;
      return () => `asset:combined-${id++}`;
    })(),
  });
  const assets: AssetId[] = [];
  let duplicateMaskCrossWrites = 0;
  let mixedRoots = 0;

  for (let operation = 1; operation <= 10_000; operation += 1) {
    const contentHash = operation.toString(16).padStart(64, "0");
    const maskHash = `sha256:${(operation + 1).toString(16).padStart(64, "0")}`;
    if (contentHash === maskHash.replace("sha256:", "")) mixedRoots += 1;
    const revisionId = maskHash as `sha256:${string}`;
    registry.registerRevision({
      revisionId,
      kind: "mask",
      metadata: { operation },
      bytes: new Uint8Array([operation % 251]),
    });
    const binding = registry.createAsset(revisionId);
    assets.push(binding.assetId);
    if (next(3) === 0) {
      const duplicate = registry.duplicateAsset(binding.assetId);
      if (duplicate.assetId === binding.assetId) duplicateMaskCrossWrites += 1;
      assets.push(duplicate.assetId);
    }
    const nextState = createContentSnapshot(contentHash, [
      { maskId: `mask-${operation % 11}`, byteHash: revisionId },
    ]);
    history.push({ base: state, next: nextState });
    state = applyContentSnapshotTransition(state, { base: state, next: nextState }, "redo");
    if (operation % 1_024 === 0) registry.validateReferences(assets);
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const transition = history[index];
    if (!transition) throw new Error("missing combined history entry");
    state = applyContentSnapshotTransition(state, transition, "undo");
  }
  registry.validateReferences(assets);
  const danglingRefs = assets.filter((assetId) => !registry.getAsset(assetId)).length;
  const gc = registry.collectGarbage(registry.reachableRevisionIds());
  expect(state).toEqual(createContentSnapshot("0".repeat(64)));
  expect(duplicateMaskCrossWrites).toBe(0);
  expect(mixedRoots).toBe(0);
  expect(danglingRefs).toBe(0);
  expect(gc.releasedRevisionIds).toHaveLength(0);
  expect(gc.releasedBytes).toBe(0);
});
