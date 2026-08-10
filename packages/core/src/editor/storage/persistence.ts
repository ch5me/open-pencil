export type PersistenceState = "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";

export interface DetachedBinaryAssetReference {
  readonly kind: "detached-binary-asset-v1";
  readonly assetId: `asset:${string}`;
  readonly revisionId: `sha256:${string}`;
  readonly mimeType: "image/png";
  readonly byteLength: number;
}

export interface DetachedBinaryAsset {
  readonly reference: DetachedBinaryAssetReference;
  readonly bytes: Uint8Array;
}

export type DurableBinaryAsset = DetachedBinaryAsset;

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

export interface DetachedWorkingDocument {
  readonly record: WorkingDocumentRecord;
  readonly assets: readonly DetachedBinaryAsset[];
}

export type RecoveredWorkingDocument = DetachedWorkingDocument;

export const PERSISTENCE_DURABLE_BOUNDARIES = [
  "asset",
  "staged-record",
  "committed-record",
  "ack",
] as const;

export type PersistenceDurableBoundary = (typeof PERSISTENCE_DURABLE_BOUNDARIES)[number];

export type PersistenceBoundaryHook = (
  boundary: PersistenceDurableBoundary,
  contentRootHash: string,
) => void;

export interface AtomicWorkingDocumentPersistenceOptions {
  readonly maxBytes?: number;
  readonly onDurableBoundary?: PersistenceBoundaryHook;
  readonly onBoundary?: PersistenceBoundaryHook;
}

export type AtomicPersistenceOptions = AtomicWorkingDocumentPersistenceOptions;

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
  override readonly name = "PersistenceContractError";
  readonly code = "E_IMAGE_PERSISTENCE_CONTRACT";
}

export class PersistenceQuotaError extends Error {
  override readonly name = "PersistenceQuotaError";
  readonly code = "E_IMAGE_PERSISTENCE_QUOTA";
}

export class PersistenceMigrationError extends Error {
  override readonly name = "PersistenceMigrationError";
  readonly code = "E_IMAGE_PERSISTENCE_MIGRATION";
}

export class PersistenceTerminationError extends Error {
  override readonly name = "PersistenceTerminationError";
  readonly code = "E_IMAGE_PERSISTENCE_TERMINATED";

  constructor(
    readonly boundary: PersistenceDurableBoundary,
    readonly seed: number,
  ) {
    super(`persistence terminated after ${boundary} for seed ${seed}`);
  }
}

const PNG_DATA_URL_PREFIX = /^data:image\/png(?:;[^,]*)?,/iu;
const BASE64_PNG_DATA_URL = /^data:image\/png;base64,([a-z\d+/]*={0,2})$/iu;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new PersistenceContractError(`${label} must be finite`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDetachedReference(value: unknown): value is DetachedBinaryAssetReference {
  return isPlainRecord(value) && value.kind === "detached-binary-asset-v1";
}

function containsPngDataUrl(value: unknown): boolean {
  if (typeof value === "string") return PNG_DATA_URL_PREFIX.test(value);
  if (Array.isArray(value)) return value.some(containsPngDataUrl);
  return isPlainRecord(value) && Object.values(value).some(containsPngDataUrl);
}

function decodePngDataUrl(dataUrl: string): Uint8Array {
  const match = BASE64_PNG_DATA_URL.exec(dataUrl);
  if (!match?.[1]) {
    throw new PersistenceMigrationError("PNG data URL must use valid base64 encoding");
  }
  let binary: string;
  try {
    binary = atob(match[1]);
  } catch {
    throw new PersistenceMigrationError("PNG data URL contains invalid base64");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new PersistenceMigrationError("PNG data URL has an invalid PNG signature");
  }
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function detachJsonValue(
  value: unknown,
  assets: Map<string, DetachedBinaryAsset>,
): Promise<unknown> {
  if (typeof value === "string" && PNG_DATA_URL_PREFIX.test(value)) {
    const bytes = decodePngDataUrl(value);
    const digest = await sha256(bytes);
    const reference: DetachedBinaryAssetReference = {
      kind: "detached-binary-asset-v1",
      assetId: `asset:${digest}`,
      revisionId: `sha256:${digest}`,
      mimeType: "image/png",
      byteLength: bytes.byteLength,
    };
    if (!assets.has(reference.revisionId)) assets.set(reference.revisionId, { reference, bytes });
    return reference;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => detachJsonValue(item, assets)));
  }
  if (isPlainRecord(value)) {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [key, await detachJsonValue(item, assets)]),
    );
    return Object.fromEntries(entries);
  }
  throw new PersistenceMigrationError("working-document payload must contain JSON values");
}

function assertDetachedReference(reference: DetachedBinaryAssetReference): void {
  if (
    reference.kind !== "detached-binary-asset-v1" ||
    !/^asset:[0-9a-f]{64}$/u.test(reference.assetId) ||
    !/^sha256:[0-9a-f]{64}$/u.test(reference.revisionId) ||
    reference.assetId.slice("asset:".length) !== reference.revisionId.slice("sha256:".length) ||
    reference.mimeType !== "image/png" ||
    !Number.isSafeInteger(reference.byteLength) ||
    reference.byteLength < PNG_SIGNATURE.length
  ) {
    throw new PersistenceMigrationError("invalid detached binary asset reference");
  }
}

export function createDetachedBinaryAssetReference(
  assetId: string,
  revisionId: string,
  mimeType: string,
  byteLength: number,
): DetachedBinaryAssetReference {
  const reference: DetachedBinaryAssetReference = {
    kind: "detached-binary-asset-v1",
    assetId: assetId as DetachedBinaryAssetReference["assetId"],
    revisionId: revisionId as DetachedBinaryAssetReference["revisionId"],
    mimeType: mimeType as DetachedBinaryAssetReference["mimeType"],
    byteLength,
  };
  assertDetachedReference(reference);
  return reference;
}

function collectDetachedReferences(
  value: unknown,
  references: DetachedBinaryAssetReference[],
): void {
  if (isDetachedReference(value)) {
    assertDetachedReference(value);
    references.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDetachedReferences(item, references));
    return;
  }
  if (isPlainRecord(value)) {
    Object.values(value).forEach((item) => collectDetachedReferences(item, references));
  }
}

function cloneDetachedAsset(asset: DetachedBinaryAsset): DetachedBinaryAsset {
  return {
    reference: structuredClone(asset.reference),
    bytes: new Uint8Array(asset.bytes),
  };
}

function cloneDetachedDocument(snapshot: DetachedWorkingDocument): DetachedWorkingDocument {
  return {
    record: structuredClone(snapshot.record),
    assets: snapshot.assets.map(cloneDetachedAsset),
  };
}

function durableRootKey(documentId: string, contentRootHash: string): string {
  return `${documentId}\0${contentRootHash}`;
}

export async function detachPngDataUrls(
  record: WorkingDocumentRecord,
): Promise<DetachedWorkingDocument> {
  validateWorkingDocumentRecord(record);
  const assets = new Map<string, DetachedBinaryAsset>();
  const payload = await detachJsonValue(record.payload, assets);
  if (!isPlainRecord(payload)) {
    throw new PersistenceMigrationError("working-document payload must be a JSON object");
  }
  const detached = {
    record: { ...structuredClone(record), payload },
    assets: [...assets.values()].map(cloneDetachedAsset),
  };
  await verifyDetachedWorkingDocument(detached.record, detached.assets);
  return detached;
}

export function validateDetachedWorkingDocument(
  record: WorkingDocumentRecord,
  assets: readonly DetachedBinaryAsset[],
): void {
  validateWorkingDocumentRecord(record);
  if (containsPngDataUrl(record.payload)) {
    throw new PersistenceMigrationError("working document contains an embedded PNG data URL");
  }

  const assetsByRevision = new Map<string, DetachedBinaryAsset>();
  for (const asset of assets) {
    assertDetachedReference(asset.reference);
    if (
      asset.bytes.byteLength !== asset.reference.byteLength ||
      PNG_SIGNATURE.some((byte, index) => asset.bytes[index] !== byte)
    ) {
      throw new PersistenceMigrationError(
        `detached binary asset bytes do not match reference: ${asset.reference.assetId}`,
      );
    }
    if (assetsByRevision.has(asset.reference.revisionId)) {
      throw new PersistenceMigrationError(
        `duplicate detached binary asset revision: ${asset.reference.revisionId}`,
      );
    }
    assetsByRevision.set(asset.reference.revisionId, asset);
  }

  const references: DetachedBinaryAssetReference[] = [];
  collectDetachedReferences(record.payload, references);
  for (const reference of references) {
    const asset = assetsByRevision.get(reference.revisionId);
    if (
      !asset ||
      asset.reference.assetId !== reference.assetId ||
      asset.reference.byteLength !== reference.byteLength ||
      asset.reference.mimeType !== reference.mimeType
    ) {
      throw new PersistenceMigrationError(`missing detached binary asset: ${reference.revisionId}`);
    }
  }
}

export async function verifyDetachedWorkingDocument(
  record: WorkingDocumentRecord,
  assets: readonly DetachedBinaryAsset[],
): Promise<void> {
  validateDetachedWorkingDocument(record, assets);
  for (const asset of assets) {
    if (`sha256:${await sha256(asset.bytes)}` !== asset.reference.revisionId) {
      throw new PersistenceMigrationError(
        `detached binary asset digest does not match reference: ${asset.reference.assetId}`,
      );
    }
  }
}

export const validateDetachedBinaryAssets = validateDetachedWorkingDocument;

export function migrateWorkingDocumentRecord(
  record: WorkingDocumentRecord,
  assets: readonly DetachedBinaryAsset[] = [],
): WorkingDocumentRecord {
  validateDetachedWorkingDocument(record, assets);
  return structuredClone(record);
}

export function createTerminationInjector(
  seed: number,
  contentRootHash?: string,
): PersistenceBoundaryHook {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new PersistenceContractError("termination seed must be a non-negative safe integer");
  }
  const boundary = PERSISTENCE_DURABLE_BOUNDARIES[seed % PERSISTENCE_DURABLE_BOUNDARIES.length];
  return (observedBoundary, observedRootHash) => {
    if (
      observedBoundary === boundary &&
      (!contentRootHash || observedRootHash === contentRootHash)
    ) {
      throw new PersistenceTerminationError(boundary, seed);
    }
  };
}

export class AtomicWorkingDocumentPersistence {
  private readonly stagedAssets = new Map<string, readonly DetachedBinaryAsset[]>();
  private readonly stagedRecords = new Map<string, WorkingDocumentRecord>();
  private readonly committedRoots = new Map<string, DetachedWorkingDocument>();
  private readonly acknowledgedRoots = new Map<string, string>();

  constructor(private readonly options: AtomicWorkingDocumentPersistenceOptions = {}) {
    if (
      options.maxBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
    ) {
      throw new PersistenceQuotaError("maxBytes must be a non-negative safe integer");
    }
  }

  async save(record: WorkingDocumentRecord, assets: readonly DetachedBinaryAsset[]): Promise<void> {
    await verifyDetachedWorkingDocument(record, assets);
    const candidate = cloneDetachedDocument({ record, assets });
    const byteLength =
      new TextEncoder().encode(JSON.stringify(candidate.record)).byteLength +
      candidate.assets.reduce((total, asset) => total + asset.bytes.byteLength, 0);
    if (this.options.maxBytes !== undefined && byteLength > this.options.maxBytes) {
      throw new PersistenceQuotaError(
        `working document requires ${byteLength} bytes; quota is ${this.options.maxBytes}`,
      );
    }

    const rootKey = durableRootKey(candidate.record.documentId, candidate.record.contentRootHash);
    this.stagedAssets.set(rootKey, candidate.assets);
    this.afterBoundary("asset", candidate.record.contentRootHash);
    this.stagedRecords.set(rootKey, candidate.record);
    this.afterBoundary("staged-record", candidate.record.contentRootHash);

    const stagedRecord = this.stagedRecords.get(rootKey);
    const stagedAssets = this.stagedAssets.get(rootKey);
    if (!stagedRecord || !stagedAssets) {
      throw new PersistenceContractError("staged persistence root is incomplete");
    }
    this.committedRoots.set(
      rootKey,
      cloneDetachedDocument({ record: stagedRecord, assets: stagedAssets }),
    );
    this.afterBoundary("committed-record", candidate.record.contentRootHash);

    this.acknowledgedRoots.set(candidate.record.documentId, candidate.record.contentRootHash);
    this.afterBoundary("ack", candidate.record.contentRootHash);
  }

  recover(documentId: string): DetachedWorkingDocument | undefined {
    const acknowledgedRoot = this.acknowledgedRoots.get(documentId);
    const acknowledged =
      acknowledgedRoot && this.committedRoots.get(durableRootKey(documentId, acknowledgedRoot));
    if (acknowledged?.record.documentId === documentId) {
      return cloneDetachedDocument(acknowledged);
    }

    const latest = [...this.committedRoots.values()]
      .filter(({ record }) => record.documentId === documentId)
      .sort(
        (left, right) =>
          right.record.contentSequence - left.record.contentSequence ||
          right.record.updatedAt - left.record.updatedAt,
      )[0];
    return latest && cloneDetachedDocument(latest);
  }

  private afterBoundary(boundary: PersistenceDurableBoundary, contentRootHash: string): void {
    (this.options.onDurableBoundary ?? this.options.onBoundary)?.(boundary, contentRootHash);
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
