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

export interface DetachedBinaryAssetReference {
  readonly assetId: string;
  readonly revisionId: string;
  readonly mimeType: string;
  readonly byteLength: number;
}

export interface DurableBinaryAsset {
  readonly reference: DetachedBinaryAssetReference;
  readonly bytes: Uint8Array;
}

export type PersistenceDurableBoundary =
  | "asset"
  | "staged-record"
  | "committed-record"
  | "ack";

export type PersistenceBoundaryHook = (
  boundary: PersistenceDurableBoundary,
  contentRootHash: string,
) => void;

export interface AtomicPersistenceOptions {
  readonly maxBytes?: number;
  readonly onBoundary?: PersistenceBoundaryHook;
}

export class PersistenceQuotaError extends Error {
  readonly code = "E_IMAGE_PERSISTENCE_QUOTA";
}

export class PersistenceMigrationError extends Error {
  readonly code = "E_IMAGE_PERSISTENCE_MIGRATION";
}

export class PersistenceTerminationError extends Error {
  readonly code = "E_IMAGE_PERSISTENCE_TERMINATED";
}

export interface RecoveredWorkingDocument {
  readonly record: WorkingDocumentRecord;
  readonly assets: readonly DurableBinaryAsset[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsEmbeddedPng(value: unknown): boolean {
  if (typeof value === "string") return /^data:image\/png(?:;base64)?,/iu.test(value);
  if (Array.isArray(value)) return value.some(containsEmbeddedPng);
  if (isRecord(value)) return Object.values(value).some(containsEmbeddedPng);
  return false;
}

function assertAssetReference(reference: DetachedBinaryAssetReference): void {
  if (!reference.assetId || !reference.revisionId || !reference.mimeType) {
    throw new PersistenceMigrationError("binary asset reference is incomplete");
  }
  if (!Number.isSafeInteger(reference.byteLength) || reference.byteLength < 0) {
    throw new PersistenceMigrationError("binary asset reference byteLength is invalid");
  }
}

export function createDetachedBinaryAssetReference(
  assetId: string,
  revisionId: string,
  mimeType: string,
  byteLength: number,
): DetachedBinaryAssetReference {
  const reference = { assetId, revisionId, mimeType, byteLength };
  assertAssetReference(reference);
  return reference;
}

export function validateDetachedBinaryAssets(
  record: WorkingDocumentRecord,
  assets: readonly DurableBinaryAsset[],
): void {
  validateWorkingDocumentRecord(record);
  if (containsEmbeddedPng(record.payload)) {
    throw new PersistenceMigrationError("working document contains embedded PNG data");
  }
  const byAssetId = new Map<string, DurableBinaryAsset>();
  for (const asset of assets) {
    assertAssetReference(asset.reference);
    if (asset.bytes.byteLength !== asset.reference.byteLength) {
      throw new PersistenceMigrationError(
        `binary asset length mismatch: ${asset.reference.assetId}`,
      );
    }
    if (byAssetId.has(asset.reference.assetId)) {
      throw new PersistenceMigrationError(`duplicate binary asset: ${asset.reference.assetId}`);
    }
    byAssetId.set(asset.reference.assetId, asset);
  }
  const referencedIds = new Set<string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (isRecord(value)) {
      if (
        typeof value.assetId === "string" &&
        typeof value.revisionId === "string" &&
        typeof value.byteLength === "number"
      ) {
        referencedIds.add(value.assetId);
      }
      Object.values(value).forEach(collect);
    }
  };
  collect(record.payload);
  for (const assetId of referencedIds) {
    if (!byAssetId.has(assetId)) throw new PersistenceMigrationError(`missing binary asset: ${assetId}`);
  }
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

export function migrateWorkingDocumentRecord(
  record: WorkingDocumentRecord,
  assets: readonly DurableBinaryAsset[] = [],
): WorkingDocumentRecord {
  if (record.schema !== "openpencil-working-document-v1" || record.schemaVersion !== 1) {
    throw new PersistenceMigrationError("unsupported working-document schema");
  }
  validateDetachedBinaryAssets(record, assets);
  return structuredClone(record);
}

export class AtomicWorkingDocumentPersistence {
  private readonly committed = new Map<string, RecoveredWorkingDocument>();
  private readonly acknowledgements = new Map<string, string>();

  constructor(private readonly options: AtomicPersistenceOptions = {}) {
    if (
      options.maxBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
    ) {
      throw new PersistenceQuotaError("maxBytes must be a non-negative safe integer");
    }
  }

  save(record: WorkingDocumentRecord, assets: readonly DurableBinaryAsset[]): void {
    const migrated = migrateWorkingDocumentRecord(record, assets);
    const clonedAssets = assets.map((asset) => ({
      reference: structuredClone(asset.reference),
      bytes: new Uint8Array(asset.bytes),
    }));
    const bytes =
      new TextEncoder().encode(JSON.stringify(migrated)).byteLength +
      clonedAssets.reduce((total, asset) => total + asset.bytes.byteLength, 0);
    if (this.options.maxBytes !== undefined && bytes > this.options.maxBytes) {
      throw new PersistenceQuotaError(`working document exceeds ${this.options.maxBytes} bytes`);
    }
    const candidate = {
      record: { ...migrated, commitState: "committed" as const },
      assets: clonedAssets,
    };
    const priorAck = this.acknowledgements.get(record.documentId);
    this.options.onBoundary?.("asset", record.contentRootHash);
    this.options.onBoundary?.("staged-record", record.contentRootHash);
    this.options.onBoundary?.("committed-record", record.contentRootHash);
    this.committed.set(record.contentRootHash, candidate);
    try {
      this.options.onBoundary?.("ack", record.contentRootHash);
      this.acknowledgements.set(record.documentId, record.contentRootHash);
    } catch (error) {
      if (priorAck === undefined) this.acknowledgements.delete(record.documentId);
      else this.acknowledgements.set(record.documentId, priorAck);
      throw error;
    }
  }

  recover(documentId: string): RecoveredWorkingDocument | undefined {
    const acknowledgedRoot = this.acknowledgements.get(documentId);
    const acknowledged = acknowledgedRoot ? this.committed.get(acknowledgedRoot) : undefined;
    if (acknowledged?.record.documentId === documentId) return cloneRecovered(acknowledged);
    const candidates = [...this.committed.values()]
      .filter(({ record }) => record.documentId === documentId)
      .sort((left, right) => right.record.contentSequence - left.record.contentSequence);
    const newest = candidates[0];
    return newest ? cloneRecovered(newest) : undefined;
  }
}

function cloneRecovered(value: RecoveredWorkingDocument): RecoveredWorkingDocument {
  return {
    record: structuredClone(value.record),
    assets: value.assets.map((asset) => ({
      reference: structuredClone(asset.reference),
      bytes: new Uint8Array(asset.bytes),
    })),
  };
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
