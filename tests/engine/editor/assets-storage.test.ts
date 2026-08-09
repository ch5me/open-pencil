import { describe, expect, test } from "bun:test";

import { AssetRegistry } from "#core/editor/assets";
import { createContentJournal, createJournalIdAllocator } from "#core/editor/history/journal";
import {
  ContentCommitMismatch,
  ContentVersionConflict,
  ImageEditorStore,
  IMAGE_EDITOR_DATABASE,
  IMAGE_EDITOR_OBJECT_STORE,
} from "#core/editor/storage";

const REVISION = `sha256:${"a".repeat(64)}` as const;
const ROOT = "b".repeat(64);

describe("image editor assets and storage", () => {
  test("keeps duplicate logical assets independent while sharing immutable revision", () => {
    const assets = new AssetRegistry({
      assetId: (() => {
        let n = 0;
        return () => `asset:${++n}`;
      })(),
    });
    assets.registerRevision({
      revisionId: REVISION,
      kind: "mask",
      metadata: { width: 1 },
      bytes: new Uint8Array([1]),
    });
    const first = assets.createAsset(REVISION);
    const duplicate = assets.duplicateAsset(first.assetId);
    expect(duplicate.assetId).not.toBe(first.assetId);
    assets.deleteAsset(first.assetId);
    expect(assets.getAsset(duplicate.assetId)?.revisionId).toBe(REVISION);
    expect(assets.collectGarbage()).toEqual({ releasedRevisionIds: [], releasedBytes: 0 });
  });

  test("reports missing references and collects unbound revisions", () => {
    const assets = new AssetRegistry({ assetId: () => "asset:one" });
    assets.registerRevision({
      revisionId: REVISION,
      kind: "image",
      metadata: {},
      bytes: new Uint8Array([1, 2]),
    });
    expect(() => assets.validateReferences(["asset:missing"])).toThrow("missing asset binding");
    expect(assets.collectGarbage()).toEqual({
      releasedRevisionIds: [REVISION],
      releasedBytes: 2,
    });
  });

  test("commits only against the observed content version", () => {
    const store = new ImageEditorStore();
    store.setInitialHead("doc", { sequence: 1, contentRootHash: ROOT });
    const allocator = createJournalIdAllocator(0, () => "tx");
    const journal = createContentJournal(allocator, {
      journalSequence: 1,
      baseContentVersion: { sequence: 1, contentRootHash: ROOT },
      nextContentVersion: { sequence: 2, contentRootHash: "c".repeat(64) },
      contractHash: "contract",
      authorityMatrixHash: "d".repeat(64),
    });
    store.commitContent({
      documentId: "doc",
      journal,
      nextHead: journal.nextContentVersion,
      revisions: [],
    });
    expect(store.getHead("doc")).toEqual(journal.nextContentVersion);
    expect(IMAGE_EDITOR_DATABASE).toBe("openpencil-image-editor-v1");
    expect(IMAGE_EDITOR_OBJECT_STORE).toBe("records");
    expect(() =>
      store.commitContent({
        documentId: "doc",
        journal,
        nextHead: journal.nextContentVersion,
        revisions: [],
      }),
    ).toThrow(ContentVersionConflict);
  });

  test("rejects a next-head mismatch before mutating content", () => {
    const store = new ImageEditorStore();
    store.setInitialHead("doc", { sequence: 1, contentRootHash: ROOT });
    const allocator = createJournalIdAllocator(0, () => "tx");
    const journal = createContentJournal(allocator, {
      journalSequence: 1,
      baseContentVersion: { sequence: 1, contentRootHash: ROOT },
      nextContentVersion: { sequence: 2, contentRootHash: "c".repeat(64) },
      contractHash: "contract",
      authorityMatrixHash: "d".repeat(64),
    });

    expect(() =>
      store.commitContent({
        documentId: "doc",
        journal,
        nextHead: { sequence: 2, contentRootHash: "e".repeat(64) },
        revisions: [],
      }),
    ).toThrow(ContentCommitMismatch);
    expect(store.getHead("doc")).toEqual(journal.baseContentVersion);
  });

  test("requires committed revisions to be declared by the journal", () => {
    const store = new ImageEditorStore();
    store.setInitialHead("doc", { sequence: 1, contentRootHash: ROOT });
    const allocator = createJournalIdAllocator(0, () => "tx");
    const journal = createContentJournal(allocator, {
      journalSequence: 1,
      baseContentVersion: { sequence: 1, contentRootHash: ROOT },
      nextContentVersion: { sequence: 2, contentRootHash: "c".repeat(64) },
      contractHash: "contract",
      authorityMatrixHash: "d".repeat(64),
    });

    expect(() =>
      store.commitContent({
        documentId: "doc",
        journal,
        nextHead: journal.nextContentVersion,
        revisions: [`sha256:${"e".repeat(64)}`],
      }),
    ).toThrow("revision is not declared by journal");
  });
});
