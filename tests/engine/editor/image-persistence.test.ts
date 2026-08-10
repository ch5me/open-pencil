import { expect, test } from "bun:test";

import {
  AtomicWorkingDocumentPersistence,
  createDetachedBinaryAssetReference,
  createPersistenceContractReceipt,
  estimateJsonOverhead,
  PersistenceContractError,
  PersistenceMigrationError,
  PersistenceQuotaError,
  recoverWorkingDocument,
  validateWorkingDocumentRecord,
  type WorkingDocumentRecord,
} from "#core/editor/storage";

const baseRecord: WorkingDocumentRecord = {
  schema: "openpencil-working-document-v1",
  schemaVersion: 1,
  documentId: "doc:one",
  contentSequence: 1,
  contentRootHash: "a".repeat(64),
  payload: { title: "Draft", assets: ["asset:one"] },
  viewport: { panX: 10, panY: 20, zoom: 1.5 },
  selectionIds: ["layer:one"],
  historySequence: 3,
  commitState: "committed",
  updatedAt: 10,
};

test("persistence-v1 validates working document and separates viewport from history", () => {
  expect(() => validateWorkingDocumentRecord(baseRecord)).not.toThrow();
  const receipt = createPersistenceContractReceipt(
    {
      indexedDbWorkingDocument: "SUPPORTED",
      atomicSave: "SUPPORTED",
      viewportPersistence: "SUPPORTED",
      selectionHistorySeparation: "SUPPORTED",
    },
    estimateJsonOverhead(baseRecord.payload),
  );
  expect(receipt.version).toBe("persistence-v1");
  expect(receipt.jsonOverheadBytes).toBeGreaterThanOrEqual(0);
  expect(receipt.selectionHistorySeparation).toBe("SUPPORTED");
});

test("persistence-v1 recovery ignores staged records and selects newest committed content", () => {
  const staged = { ...baseRecord, contentSequence: 5, commitState: "staged" as const };
  const committed = { ...baseRecord, contentSequence: 2, updatedAt: 20 };
  const recovered = recoverWorkingDocument([staged, baseRecord, committed], "doc:one");
  expect(recovered?.contentSequence).toBe(2);
  expect(recoverWorkingDocument([baseRecord], "doc:missing")).toBeUndefined();
  expect(() =>
    validateWorkingDocumentRecord({ ...baseRecord, viewport: { ...baseRecord.viewport, zoom: 0 } }),
  ).toThrow(PersistenceContractError);
});

test("persistence-v1 stores binary assets detached from document JSON", () => {
  const reference = createDetachedBinaryAssetReference("asset:one", "sha256:one", "image/png", 3);
  const record = {
    ...baseRecord,
    payload: { title: "Draft", image: reference },
  };
  const persistence = new AtomicWorkingDocumentPersistence();
  persistence.save(record, [{ reference, bytes: new Uint8Array([1, 2, 3]) }]);
  const recovered = persistence.recover(record.documentId);
  expect(recovered?.record.payload).toEqual(record.payload);
  expect(recovered?.assets[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(() =>
    persistence.save({ ...record, payload: { image: "data:image/png;base64,AAAA" } }, []),
  ).toThrow(PersistenceMigrationError);
});

test("persistence-v1 termination keeps prior ACK or one complete new root", () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const first = { ...baseRecord, contentSequence: seed };
    const second = {
      ...baseRecord,
      contentSequence: seed + 1,
      contentRootHash: seed.toString(16).padStart(64, "0"),
    };
    for (const boundary of ["asset", "staged-record", "committed-record", "ack"] as const) {
      let armed = false;
      const persistence = new AtomicWorkingDocumentPersistence({
        onBoundary: (current) => {
          if (current === boundary && armed) {
            throw new Error(`terminated at ${current}`);
          }
        },
      });
      persistence.save(first, []);
      armed = true;
      expect(() => persistence.save(second, [])).toThrow(`terminated at ${boundary}`);
      expect(persistence.recover("doc:one")?.record.contentRootHash).toBe("a".repeat(64));
    }
  }
});

test("persistence-v1 quota failure is non-destructive across 100 deterministic seeds", () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const first = { ...baseRecord, contentSequence: seed, updatedAt: seed };
    const persistence = new AtomicWorkingDocumentPersistence({ maxBytes: 1 });
    expect(() => persistence.save(first, [])).toThrow(PersistenceQuotaError);
    expect(persistence.recover(first.documentId)).toBeUndefined();
  }
});
