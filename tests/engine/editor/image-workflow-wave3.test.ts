import { expect, test } from "bun:test";

import { AssetRegistry } from "#core/editor/assets";
import {
  AUTHORITY_MATRIX_HASH,
  PATH_ALLOCATION_HASH,
} from "#core/editor/image-contracts";
import { createBrushStroke } from "#core/editor/image-brush";
import { createJournalIdAllocator, createContentJournal } from "#core/editor/history/journal";
import { createRasterMutation } from "#core/editor/image-raster";
import {
  closeDocument,
  createImageSession,
  markDocumentDirty,
  openDocument,
} from "#core/editor/image-session";
import { ContentCommitMismatch, ImageEditorStore, StagedChunkMismatch } from "#core/editor/storage";

const revisionId = `sha256:${"a".repeat(64)}` as const;
const contentHash = "b".repeat(64);

test("wave-3 product lane commits an image edit and reopens its durable head", () => {
  const store = new ImageEditorStore();
  const registry = new AssetRegistry({
    assetId: (() => {
      let index = 0;
      return () => `asset:wave3-${index++}`;
    })(),
  });
  registry.registerRevision({
    revisionId,
    kind: "image",
    metadata: { width: 100, height: 80 },
    bytes: new Uint8Array([1, 2, 3]),
  });
  const asset = registry.createAsset(revisionId);
  const session = openDocument(createImageSession(), "doc:wave3", "Wave 3", "tx:open");
  const mutation = createRasterMutation(
    "paint",
    { sourceId: asset.assetId, revisionId, width: 100, height: 80 },
    "tx:wave3-edit",
  );
  const stroke = createBrushStroke(
    {
      maskId: "mask:wave3",
      revisionId,
      thumbnailId: "thumb:wave3",
      enabled: true,
      inverted: false,
      displayMode: "overlay",
      transform: [1, 0, 0, 1, 0, 0],
    },
    {
      size: 12,
      hardness: 1,
      opacity: 1,
      flow: 1,
      spacing: 0.1,
      pressure: false,
      smoothing: 0,
    },
    [{ x: 10, y: 12, pressure: 1, time: 1 }],
    mutation.transactionId,
  );
  expect(stroke.transactionId).toBe(mutation.transactionId);

  store.setInitialHead("doc:wave3", { sequence: 0, contentRootHash: "0".repeat(64) });
  const allocator = createJournalIdAllocator(0, () => "wave3");
  const journal = createContentJournal(allocator, {
    journalSequence: allocator.journalSequence(),
    baseContentVersion: { sequence: 0, contentRootHash: "0".repeat(64) },
    nextContentVersion: { sequence: 1, contentRootHash: contentHash },
    contractHash: `sha256:${"c".repeat(64)}`,
    authorityMatrixHash: AUTHORITY_MATRIX_HASH,
    capabilityVersions: ["raster-v1", "brush-mask-v1"],
    forwardOps: [mutation, stroke],
    stagedContentRevisions: [
      {
        revisionId,
        kind: "image",
        metadata: {},
        byteLength: 3,
        sha256: revisionId.slice("sha256:".length),
        temporary: false,
      },
    ],
    now: 1,
  });
  store.stageChunk({
    transactionId: journal.transactionId,
    chunkIndex: 0,
    offset: 0,
    byteLength: 3,
    sha256: revisionId.slice("sha256:".length),
    final: true,
    bytes: new Uint8Array([1, 2, 3]),
  });
  store.commitContent({
    documentId: "doc:wave3",
    journal,
    nextHead: journal.nextContentVersion,
    revisions: [revisionId],
  });

  const dirty = markDocumentDirty(session.state, "doc:wave3", true, mutation.transactionId);
  expect(dirty.state.tabs[0]?.dirty).toBe(true);
  expect(store.getHead("doc:wave3")).toEqual({
    sequence: 1,
    contentRootHash: contentHash,
  });
  expect(store.getJournal("doc:wave3", 1)?.transactionId).toBe(journal.transactionId);
  expect(registry.getAsset(asset.assetId)?.revisionId).toBe(revisionId);

  const reopened = openDocument(createImageSession(), "doc:wave3", "Wave 3", "tx:reopen");
  expect(reopened.state.tabs[0]?.documentId).toBe("doc:wave3");
  expect(closeDocument(reopened.state, "doc:wave3", "tx:close").state.activeDocumentId).toBeNull();
  expect(PATH_ALLOCATION_HASH).toMatch(/^[0-9a-f]{64}$/u);
});

test("wave-3 commit lane fails loud when staged output is missing", () => {
  const store = new ImageEditorStore();
  store.setInitialHead("doc:wave3", { sequence: 0, contentRootHash: "0".repeat(64) });
  const allocator = createJournalIdAllocator(0, () => "missing");
  const journal = createContentJournal(allocator, {
    journalSequence: allocator.journalSequence(),
    baseContentVersion: { sequence: 0, contentRootHash: "0".repeat(64) },
    nextContentVersion: { sequence: 1, contentRootHash: "1".repeat(64) },
    contractHash: `sha256:${"c".repeat(64)}`,
    authorityMatrixHash: AUTHORITY_MATRIX_HASH,
    stagedContentRevisions: [
      {
        revisionId,
        kind: "image",
        metadata: {},
        byteLength: 3,
        sha256: revisionId.slice("sha256:".length),
        temporary: false,
      },
    ],
    now: 1,
  });

  expect(() =>
    store.commitContent({
      documentId: "doc:wave3",
      journal,
      nextHead: journal.nextContentVersion,
      revisions: [revisionId],
    }),
  ).toThrow(StagedChunkMismatch);
  expect(store.getHead("doc:wave3")?.sequence).toBe(0);
});
