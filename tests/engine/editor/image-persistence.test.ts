import { expect, test } from "bun:test";

import {
  createPersistenceContractReceipt,
  estimateJsonOverhead,
  PersistenceContractError,
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
