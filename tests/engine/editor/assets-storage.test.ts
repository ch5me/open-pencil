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

  test("resolves archive pins against staged and previously committed revisions", () => {
    const store = new ImageEditorStore();
    store.setInitialHead("doc", { sequence: 1, contentRootHash: ROOT });
    const allocator = createJournalIdAllocator(0, () => "tx");
    const revision = {
      revisionId: REVISION,
      kind: "image",
      metadata: { width: 1 },
      byteLength: 1,
      sha256: REVISION.slice("sha256:".length),
      temporary: false,
    } as const;
    const first = createContentJournal(allocator, {
      journalSequence: 1,
      baseContentVersion: { sequence: 1, contentRootHash: ROOT },
      nextContentVersion: { sequence: 2, contentRootHash: "c".repeat(64) },
      contractHash: "contract",
      authorityMatrixHash: "d".repeat(64),
      stagedContentRevisions: [revision],
    });
    store.stageChunk({
      transactionId: first.transactionId,
      chunkIndex: 0,
      offset: 0,
      byteLength: 1,
      sha256: revision.sha256,
      final: true,
      bytes: new Uint8Array([1]),
    });
    store.commitContent({ documentId: "doc", journal: first, nextHead: first.nextContentVersion, revisions: [REVISION] });

    const second = createContentJournal(allocator, {
      journalSequence: 2,
      baseContentVersion: first.nextContentVersion,
      nextContentVersion: { sequence: 3, contentRootHash: "e".repeat(64) },
      contractHash: "contract",
      authorityMatrixHash: "d".repeat(64),
      historyPinsAdded: [{ pinId: "archive", kind: "archive", revisionIds: [REVISION] }],
    });
    expect(() =>
      store.commitContent({ documentId: "doc", journal: second, nextHead: second.nextContentVersion, revisions: [] }),
    ).not.toThrow();
  });

  test("rejects missing, released, and colliding archive references before head mutation", () => {
    const store = new ImageEditorStore();
    store.setInitialHead("doc", { sequence: 1, contentRootHash: ROOT });
    const allocator = createJournalIdAllocator(0, () => "tx");
    const base = {
      journalSequence: 1,
      baseContentVersion: { sequence: 1, contentRootHash: ROOT },
      nextContentVersion: { sequence: 2, contentRootHash: "c".repeat(64) },
      contractHash: "contract",
      authorityMatrixHash: "d".repeat(64),
    };
    const unknown = `sha256:${"f".repeat(64)}` as const;
    const missing = createContentJournal(allocator, {
      ...base,
      historyPinsAdded: [{ pinId: "missing", kind: "archive", revisionIds: [unknown] }],
    });
    expect(() =>
      store.commitContent({ documentId: "doc", journal: missing, nextHead: missing.nextContentVersion, revisions: [] }),
    ).toThrow("missing revision");
    expect(store.getHead("doc")).toEqual(base.baseContentVersion);

    const released = createContentJournal(allocator, {
      ...base,
      historyPinsAdded: [{ pinId: "released", kind: "archive", revisionIds: [REVISION] }],
      releasedContentRevisions: [REVISION],
    });
    expect(() =>
      store.commitContent({ documentId: "doc", journal: released, nextHead: released.nextContentVersion, revisions: [] }),
    ).toThrow("released revision");
    expect(store.getHead("doc")).toEqual(base.baseContentVersion);
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

  test("rejects an invalid archive journal before changing the content head", () => {
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
    const invalidJournal = {
      ...journal,
      historyPinsAdded: [{ pinId: "archive", kind: "archive", revisionIds: [] }],
    };

    expect(() =>
      store.commitContent({
        documentId: "doc",
        journal: invalidJournal,
        nextHead: journal.nextContentVersion,
        revisions: [],
      }),
    ).toThrow("at least one revision");
    expect(store.getHead("doc")).toEqual(journal.baseContentVersion);
    expect(store.getJournal("doc", 1)).toBeUndefined();
  });
});
