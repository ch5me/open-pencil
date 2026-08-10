import { expect, test } from "bun:test";

import {
  AtomicWorkingDocumentPersistence,
  createPersistenceContractReceipt,
  createTerminationInjector,
  detachPngDataUrls,
  estimateJsonOverhead,
  PersistenceContractError,
  PersistenceMigrationError,
  PersistenceQuotaError,
  PersistenceTerminationError,
  recoverWorkingDocument,
  validateWorkingDocumentRecord,
  type DetachedWorkingDocument,
  type WorkingDocumentRecord,
} from "#core/editor/storage";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";
const PRIOR_ROOT = "a".repeat(64);
const NEXT_ROOT = "b".repeat(64);

function record(
  contentRootHash: string,
  contentSequence: number,
  payload: Readonly<Record<string, unknown>>,
): WorkingDocumentRecord {
  return {
    schema: "openpencil-working-document-v1",
    schemaVersion: 1,
    documentId: "doc:one",
    contentSequence,
    contentRootHash,
    payload,
    viewport: { panX: 10, panY: 20, zoom: 1.5 },
    selectionIds: ["layer:one"],
    historySequence: 3,
    commitState: "committed",
    updatedAt: contentSequence * 10,
  };
}

async function detached(
  contentRootHash: string,
  contentSequence: number,
): Promise<DetachedWorkingDocument> {
  return detachPngDataUrls(
    record(contentRootHash, contentSequence, {
      title: contentSequence === 1 ? "Prior" : "Next",
      image: PNG_DATA_URL,
    }),
  );
}

test("persistence-v1 detaches and deduplicates PNG bytes outside JSON", async () => {
  const result = await detachPngDataUrls(
    record(NEXT_ROOT, 2, {
      image: PNG_DATA_URL,
      nested: [{ duplicate: PNG_DATA_URL }],
    }),
  );
  const json = JSON.stringify(result.record);
  expect(json).not.toContain("data:image/png");
  expect(result.assets).toHaveLength(1);
  expect(result.assets[0]?.bytes).toEqual(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(json.match(/detached-binary-asset-v1/gu)).toHaveLength(2);
});

test("persistence-v1 recovers prior ACK or the complete new root over 100 terminations", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const next = await detached(NEXT_ROOT, 2);
  let priorRecoveries = 0;
  let newRecoveries = 0;
  let mixedRoots = 0;

  for (let seed = 0; seed < 100; seed++) {
    const store = new AtomicWorkingDocumentPersistence({
      onDurableBoundary: createTerminationInjector(seed, NEXT_ROOT),
    });
    await store.save(prior.record, prior.assets);
    await expect(store.save(next.record, next.assets)).rejects.toBeInstanceOf(
      PersistenceTerminationError,
    );

    const recovered = store.recover("doc:one");
    expect(recovered).toBeDefined();
    const recoveredRoot = recovered?.record.contentRootHash;
    expect([PRIOR_ROOT, NEXT_ROOT]).toContain(recoveredRoot);
    if (recoveredRoot === PRIOR_ROOT) priorRecoveries++;
    if (recoveredRoot === NEXT_ROOT) newRecoveries++;

    const expected = recoveredRoot === PRIOR_ROOT ? prior : next;
    if (
      JSON.stringify(recovered?.record) !== JSON.stringify(expected.record) ||
      JSON.stringify(recovered?.assets.map(({ reference }) => reference)) !==
        JSON.stringify(expected.assets.map(({ reference }) => reference)) ||
      recovered?.assets.some(
        (asset, index) =>
          asset.bytes.byteLength !== expected.assets[index]?.bytes.byteLength ||
          asset.bytes.some((byte, byteIndex) => byte !== expected.assets[index]?.bytes[byteIndex]),
      )
    ) {
      mixedRoots++;
    }
  }

  expect(priorRecoveries).toBe(75);
  expect(newRecoveries).toBe(25);
  expect(mixedRoots).toBe(0);
});

test("persistence-v1 first-save termination recovers nothing or one complete new root", async () => {
  const next = await detached(NEXT_ROOT, 1);
  for (let seed = 0; seed < 4; seed++) {
    const store = new AtomicWorkingDocumentPersistence({
      onDurableBoundary: createTerminationInjector(seed, NEXT_ROOT),
    });
    await expect(store.save(next.record, next.assets)).rejects.toBeInstanceOf(
      PersistenceTerminationError,
    );
    const recovered = store.recover("doc:one");
    if (seed < 2) {
      expect(recovered).toBeUndefined();
    } else {
      expect(recovered).toEqual(next);
    }
  }
});

test("persistence-v1 isolates equal content roots belonging to different documents", async () => {
  const first = await detached(PRIOR_ROOT, 1);
  const second = {
    record: { ...first.record, documentId: "doc:two" },
    assets: first.assets,
  };
  const store = new AtomicWorkingDocumentPersistence();
  await store.save(first.record, first.assets);
  await store.save(second.record, second.assets);
  expect(store.recover("doc:one")?.record.documentId).toBe("doc:one");
  expect(store.recover("doc:two")?.record.documentId).toBe("doc:two");
});

test("persistence-v1 quota and migration failures preserve the acknowledged root", async () => {
  const prior = await detached(PRIOR_ROOT, 1);
  const quotaStore = new AtomicWorkingDocumentPersistence({
    maxBytes:
      new TextEncoder().encode(JSON.stringify(prior.record)).byteLength +
      prior.assets.reduce((total, asset) => total + asset.bytes.byteLength, 0),
  });
  await quotaStore.save(prior.record, prior.assets);
  const oversized = await detachPngDataUrls(
    record(NEXT_ROOT, 2, { image: PNG_DATA_URL, padding: "x".repeat(256) }),
  );
  await expect(quotaStore.save(oversized.record, oversized.assets)).rejects.toBeInstanceOf(
    PersistenceQuotaError,
  );
  expect(quotaStore.recover("doc:one")?.record.contentRootHash).toBe(PRIOR_ROOT);

  const migrationStore = new AtomicWorkingDocumentPersistence();
  await migrationStore.save(prior.record, prior.assets);
  await expect(
    migrationStore.save(record(NEXT_ROOT, 2, { image: PNG_DATA_URL }), []),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  expect(migrationStore.recover("doc:one")?.record.contentRootHash).toBe(PRIOR_ROOT);

  const digestMismatch = await detachPngDataUrls(
    record(NEXT_ROOT, 2, { image: "data:image/png;base64,iVBORw0KGgoA" }),
  );
  if (digestMismatch.assets[0]) digestMismatch.assets[0].bytes[8] = 1;
  await expect(
    migrationStore.save(digestMismatch.record, digestMismatch.assets),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
  expect(migrationStore.recover("doc:one")?.record.contentRootHash).toBe(PRIOR_ROOT);
  await expect(
    detachPngDataUrls(record(NEXT_ROOT, 2, { image: "data:image/png;base64,bm90LXBuZw==" })),
  ).rejects.toBeInstanceOf(PersistenceMigrationError);
});

test("persistence-v1 preserves existing record and receipt APIs", () => {
  const baseRecord = record(PRIOR_ROOT, 1, { title: "Draft", assets: ["asset:one"] });
  expect(() => validateWorkingDocumentRecord(baseRecord)).not.toThrow();
  const receipt = createPersistenceContractReceipt(
    {
      atomicSave: "SUPPORTED",
      deduplication: "SUPPORTED",
      schemaMigration: "SUPPORTED",
      crashRecovery: "SUPPORTED",
    },
    estimateJsonOverhead(baseRecord.payload),
  );
  expect(receipt.version).toBe("persistence-v1");
  expect(receipt.jsonOverheadBytes).toBeGreaterThanOrEqual(0);

  const staged = { ...baseRecord, contentSequence: 5, commitState: "staged" as const };
  const committed = { ...baseRecord, contentSequence: 2, updatedAt: 20 };
  expect(recoverWorkingDocument([staged, baseRecord, committed], "doc:one")?.contentSequence).toBe(
    2,
  );
  expect(recoverWorkingDocument([baseRecord], "doc:missing")).toBeUndefined();
  expect(() =>
    validateWorkingDocumentRecord({ ...baseRecord, viewport: { ...baseRecord.viewport, zoom: 0 } }),
  ).toThrow(PersistenceContractError);
});
