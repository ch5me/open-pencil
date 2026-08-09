export type PersistenceState = "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";

export interface WorkingDocumentRecord {
  readonly schema: "openpencil-working-document-v1";
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly contentSequence: number;
  readonly contentRootHash: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly viewport: {
    readonly panX: number;
    readonly panY: number;
    readonly zoom: number;
  };
  readonly selectionIds: readonly string[];
  readonly historySequence: number;
  readonly commitState: "staged" | "committed";
  readonly updatedAt: number;
}

export interface PersistenceContractReceipt {
  readonly version: "persistence-v1";
  readonly jsonOverheadBytes: number;
  readonly streamingArchive: PersistenceState;
  readonly schemaMigration: PersistenceState;
  readonly indexedDbWorkingDocument: PersistenceState;
  readonly atomicSave: PersistenceState;
  readonly deduplication: PersistenceState;
  readonly viewportPersistence: PersistenceState;
  readonly selectionHistorySeparation: PersistenceState;
  readonly crashRecovery: PersistenceState;
}

export class PersistenceContractError extends Error {
  readonly code = "E_IMAGE_PERSISTENCE_CONTRACT";
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new PersistenceContractError(`${label} must be finite`);
}

export function estimateJsonOverhead(payload: Readonly<Record<string, unknown>>): number {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  return jsonBytes - new TextEncoder().encode(JSON.stringify(Object.values(payload))).byteLength;
}

export function validateWorkingDocumentRecord(record: WorkingDocumentRecord): void {
  if (
    record.schema !== "openpencil-working-document-v1" ||
    record.schemaVersion !== 1 ||
    !record.documentId ||
    !/^[0-9a-f]{64}$/u.test(record.contentRootHash)
  ) {
    throw new PersistenceContractError("invalid working-document identity");
  }
  if (!Number.isSafeInteger(record.contentSequence) || record.contentSequence < 0) {
    throw new PersistenceContractError("invalid content sequence");
  }
  if (!Number.isSafeInteger(record.historySequence) || record.historySequence < 0) {
    throw new PersistenceContractError("invalid history sequence");
  }
  assertFinite(record.viewport.panX, "viewport.panX");
  assertFinite(record.viewport.panY, "viewport.panY");
  if (!Number.isFinite(record.viewport.zoom) || record.viewport.zoom <= 0) {
    throw new PersistenceContractError("viewport.zoom must be positive");
  }
  if (!Number.isFinite(record.updatedAt)) {
    throw new PersistenceContractError("updatedAt must be finite");
  }
}

export function recoverWorkingDocument(
  records: readonly WorkingDocumentRecord[],
  documentId: string,
): WorkingDocumentRecord | undefined {
  const candidates = records.filter(
    (record) => record.documentId === documentId && record.commitState === "committed",
  );
  candidates.forEach(validateWorkingDocumentRecord);
  return candidates
    .slice()
    .sort(
      (left, right) =>
        right.contentSequence - left.contentSequence || right.updatedAt - left.updatedAt,
    )[0];
}

export function createPersistenceContractReceipt(
  overrides: Partial<Omit<PersistenceContractReceipt, "version" | "jsonOverheadBytes">> = {},
  jsonOverheadBytes = 0,
): PersistenceContractReceipt {
  if (!Number.isSafeInteger(jsonOverheadBytes) || jsonOverheadBytes < 0) {
    throw new PersistenceContractError("json overhead must be a non-negative safe integer");
  }
  return {
    version: "persistence-v1",
    jsonOverheadBytes,
    streamingArchive: "UNKNOWN",
    schemaMigration: "UNKNOWN",
    indexedDbWorkingDocument: "UNKNOWN",
    atomicSave: "UNKNOWN",
    deduplication: "UNKNOWN",
    viewportPersistence: "UNKNOWN",
    selectionHistorySeparation: "UNKNOWN",
    crashRecovery: "UNKNOWN",
    ...overrides,
  };
}
