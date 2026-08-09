import { expect, test } from "bun:test";

import { AssetRegistry, type AssetId } from "#core/editor/assets";
import {
  applyContentSnapshotTransition,
  createContentSnapshot,
  createContentJournal,
  createJournalIdAllocator,
  type ContentSnapshot,
} from "#core/editor/history/journal";
import { ImageEditorStore, StagedChunkMemoryPressure } from "#core/editor/storage";

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

test("committing content releases staged chunks after publishing the new head", () => {
  const store = new ImageEditorStore();
  const root = "a".repeat(64);
  const nextRoot = "b".repeat(64);
  store.setInitialHead("doc", { sequence: 1, contentRootHash: root });
  const allocator = createJournalIdAllocator(0, () => "commit");
  const journal = createContentJournal(allocator, {
    journalSequence: 1,
    baseContentVersion: { sequence: 1, contentRootHash: root },
    nextContentVersion: { sequence: 2, contentRootHash: nextRoot },
    contractHash: "contract",
    authorityMatrixHash: "d".repeat(64),
    stagedContentRevisions: [
      {
        revisionId: `sha256:${"b".repeat(64)}`,
        kind: "image",
        metadata: {},
        byteLength: 1,
        sha256: "b".repeat(64),
        temporary: false,
      },
    ],
  });
  store.stageChunk({
    transactionId: journal.transactionId,
    chunkIndex: 0,
    offset: 0,
    byteLength: 1,
    sha256: "b".repeat(64),
    final: true,
    bytes: new Uint8Array([1]),
  });

  store.commitContent({
    documentId: "doc",
    journal,
    nextHead: journal.nextContentVersion,
    revisions: [`sha256:${"b".repeat(64)}`],
  });

  expect(store.stagedChunkCount(journal.transactionId)).toBe(0);
  expect(store.getHead("doc")).toEqual(journal.nextContentVersion);
});

test("committed snapshots retain raster hashes through undo, redo, and release checks", () => {
  const store = new ImageEditorStore();
  const root = "a".repeat(64);
  const nextRoot = "b".repeat(64);
  const maskHash = `sha256:${"c".repeat(64)}` as const;
  store.setInitialHead("doc:history", { sequence: 0, contentRootHash: root });
  const allocator = createJournalIdAllocator(0, (() => {
    let id = 0;
    return () => `history-${id++}`;
  })());
  const baseSnapshot = createContentSnapshot(root);
  const nextSnapshot = createContentSnapshot(nextRoot, [{ maskId: "mask:one", byteHash: maskHash }]);
  const journal = createContentJournal(allocator, {
    journalSequence: 1,
    baseContentVersion: { sequence: 0, contentRootHash: root },
    nextContentVersion: { sequence: 1, contentRootHash: nextRoot },
    baseContentSnapshot: baseSnapshot,
    nextContentSnapshot: nextSnapshot,
    contractHash: "contract",
    authorityMatrixHash: "d".repeat(64),
    stagedContentRevisions: [{
      revisionId: maskHash,
      kind: "mask",
      metadata: {},
      byteLength: 1,
      sha256: maskHash.slice("sha256:".length),
      temporary: false,
    }],
  });
  store.stageChunk({
    transactionId: journal.transactionId,
    chunkIndex: 0,
    offset: 0,
    byteLength: 1,
    sha256: maskHash.slice("sha256:".length),
    final: true,
    bytes: new Uint8Array([1]),
  });
  store.commitContent({
    documentId: "doc:history",
    journal,
    nextHead: journal.nextContentVersion,
    revisions: [maskHash],
  });
  expect(store.getContentSnapshot("doc:history")).toEqual(nextSnapshot);
  expect(store.transitionContentSnapshot("doc:history", { base: baseSnapshot, next: nextSnapshot }, "undo"))
    .toEqual(baseSnapshot);
  expect(store.transitionContentSnapshot("doc:history", { base: baseSnapshot, next: nextSnapshot }, "redo"))
    .toEqual(nextSnapshot);

  const release = createContentJournal(allocator, {
    journalSequence: 2,
    baseContentVersion: journal.nextContentVersion,
    nextContentVersion: { sequence: 2, contentRootHash: "e".repeat(64) },
    baseContentSnapshot: nextSnapshot,
    contractHash: "contract",
    authorityMatrixHash: "d".repeat(64),
    releasedContentRevisions: [maskHash],
  });
  expect(() =>
    store.commitContent({
      documentId: "doc:history",
      journal: release,
      nextHead: release.nextContentVersion,
      revisions: [],
    }),
  ).toThrow("content snapshot references released revision");
});

test("staged chunks validate offsets and content digests", () => {
  const store = new ImageEditorStore();
  const base = {
    transactionId: "tx:validate",
    chunkIndex: 0,
    offset: 0,
    byteLength: 1,
    sha256: "b".repeat(64),
    final: true,
    bytes: new Uint8Array([1]),
  };
  expect(() => store.stageChunk({ ...base, offset: -1 })).toThrow(
    "offset must be a non-negative safe integer",
  );
  expect(() => store.stageChunk({ ...base, sha256: "not-a-digest" })).toThrow(
    "staged chunk sha256 must be a lowercase SHA-256 hex digest",
  );
  expect(() => store.stageChunk(base)).not.toThrow();
});

test("staged upload enforces a byte admission without double-counting retries", () => {
  const store = new ImageEditorStore({ maxStagedBytes: 3 });
  const base = {
    transactionId: "tx:pressure",
    chunkIndex: 0,
    offset: 0,
    byteLength: 2,
    sha256: "b".repeat(64),
    final: false,
    bytes: new Uint8Array([1, 2]),
  };
  store.stageChunk(base);
  store.stageChunk({ ...base, bytes: new Uint8Array([3, 4]) });
  expect(store.stagedChunkCount("tx:pressure")).toBe(1);
  expect(() =>
    store.stageChunk({
      ...base,
      chunkIndex: 1,
      offset: 2,
      byteLength: 2,
      bytes: new Uint8Array([5, 6]),
    }),
  ).toThrow(StagedChunkMemoryPressure);
  store.discardStaged("tx:pressure");
  expect(store.stagedChunkCount("tx:pressure")).toBe(0);
});

test("asset revisions reject same-size content mutation and allocator collisions", () => {
  const registry = new AssetRegistry({ assetId: () => "asset:fixed" });
  registry.registerRevision({
    revisionId: revision(1),
    kind: "image",
    metadata: { width: 1 },
    bytes: new Uint8Array([1, 2]),
  });
  expect(() =>
    registry.registerRevision({
      revisionId: revision(1),
      kind: "image",
      metadata: { width: 1 },
      bytes: new Uint8Array([1, 3]),
    }),
  ).toThrow("immutable asset revision conflict");
  registry.createAsset(revision(1));
  expect(() => registry.createAsset(revision(1))).toThrow("duplicate asset binding");
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
