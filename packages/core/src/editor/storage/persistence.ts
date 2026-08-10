/* oxlint-disable max-lines */

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

export interface AcknowledgedWorkingDocumentIdentity {
  readonly contentSequence: number;
  readonly contentRootHash: string;
  readonly rootKey: string;
}

export interface SaveWorkingDocumentOptions {
  readonly expectedAcknowledgement?: AcknowledgedWorkingDocumentIdentity;
  readonly expectedContentRootHash?: string;
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

export class PersistenceConflictError extends Error {
  override readonly name = "PersistenceConflictError";
  readonly code = "E_IMAGE_PERSISTENCE_CONFLICT";
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
const WORKING_DOCUMENT_RECORD_KEYS = new Set([
  "schema",
  "schemaVersion",
  "documentId",
  "contentSequence",
  "contentRootHash",
  "payload",
  "viewport",
  "selectionIds",
  "historySequence",
  "commitState",
  "updatedAt",
]);

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

// oxlint-disable-next-line complexity
function assertJsonValue(value: unknown, ancestors = new Set<object>()): void {
  const primitive =
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0));
  if (primitive) return;
  if (typeof value !== "object")
    throw new PersistenceContractError("working-document payload must contain JSON values");
  if (ancestors.has(value))
    throw new PersistenceContractError("working-document payload must not contain cycles");
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length),
      ) ||
      Array.from({ length: value.length }, (_, index) => index).some(
        (index) => !Object.hasOwn(value, index),
      )
    ) {
      throw new PersistenceContractError("working-document payload arrays must be dense");
    }
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new PersistenceContractError("working-document payload has non-JSON properties");
      }
      assertJsonValue(descriptor.value, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (!isPlainRecord(value))
    throw new PersistenceContractError("working-document payload must contain plain objects");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor)) {
      throw new PersistenceContractError("working-document payload has non-JSON properties");
    }
    assertJsonValue(descriptor.value, ancestors);
  }
  ancestors.delete(value);
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
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
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

function assertDetachedReference(
  reference: unknown,
): asserts reference is DetachedBinaryAssetReference {
  if (
    !isPlainRecord(reference) ||
    reference.kind !== "detached-binary-asset-v1" ||
    typeof reference.assetId !== "string" ||
    !/^asset:[0-9a-f]{64}$/u.test(reference.assetId) ||
    typeof reference.revisionId !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(reference.revisionId) ||
    reference.assetId.slice("asset:".length) !== reference.revisionId.slice("sha256:".length) ||
    reference.mimeType !== "image/png" ||
    typeof reference.byteLength !== "number" ||
    !Number.isSafeInteger(reference.byteLength) ||
    reference.byteLength < PNG_SIGNATURE.length ||
    Reflect.ownKeys(reference).length !== 5
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
  const reference = {
    kind: "detached-binary-asset-v1",
    assetId,
    revisionId,
    mimeType,
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

function durableRootKey(
  documentId: string,
  contentSequence: number,
  contentRootHash: string,
): string {
  return `${documentId}\0${contentSequence}\0${contentRootHash}`;
}

type AcknowledgedRoot = AcknowledgedWorkingDocumentIdentity;

function assertAcknowledgementIdentity(
  documentId: string,
  identity: AcknowledgedWorkingDocumentIdentity,
): void {
  assertJsonValue(identity);
  if (
    !isPlainRecord(identity) ||
    Reflect.ownKeys(identity).length !== 3 ||
    !Number.isSafeInteger(identity.contentSequence) ||
    identity.contentSequence < 0 ||
    typeof identity.contentRootHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(identity.contentRootHash) ||
    identity.rootKey !==
      durableRootKey(documentId, identity.contentSequence, identity.contentRootHash)
  ) {
    throw new PersistenceContractError("expected acknowledgement identity is invalid");
  }
}

export function createAcknowledgedWorkingDocumentIdentity(
  documentId: string,
  contentSequence: number,
  contentRootHash: string,
): AcknowledgedWorkingDocumentIdentity {
  const identity = {
    contentSequence,
    contentRootHash,
    rootKey: durableRootKey(documentId, contentSequence, contentRootHash),
  };
  assertAcknowledgementIdentity(documentId, identity);
  return identity;
}

function assertExpectedAcknowledgement(
  documentId: string,
  expectedAcknowledgement: AcknowledgedWorkingDocumentIdentity | undefined,
  acknowledgedRoot: AcknowledgedRoot | undefined,
): void {
  if (expectedAcknowledgement === undefined) return;
  assertAcknowledgementIdentity(documentId, expectedAcknowledgement);
  if (
    !acknowledgedRoot ||
    expectedAcknowledgement.contentSequence !== acknowledgedRoot.contentSequence ||
    expectedAcknowledgement.contentRootHash !== acknowledgedRoot.contentRootHash ||
    expectedAcknowledgement.rootKey !== acknowledgedRoot.rootKey
  ) {
    throw new PersistenceConflictError(
      `working document acknowledgement changed from sequence ${expectedAcknowledgement.contentSequence} root ${expectedAcknowledgement.contentRootHash} to sequence ${acknowledgedRoot?.contentSequence ?? "none"} root ${acknowledgedRoot?.contentRootHash ?? "none"}`,
    );
  }
}

function assertExpectedContentRootHash(
  expectedContentRootHash: string | undefined,
  acknowledgedRoot: AcknowledgedRoot | undefined,
): void {
  if (expectedContentRootHash !== undefined && !/^[0-9a-f]{64}$/u.test(expectedContentRootHash)) {
    throw new PersistenceContractError("expected content root hash must be a SHA-256 digest");
  }
  if (expectedContentRootHash !== undefined && acknowledgedRoot) {
    throw new PersistenceContractError(
      "expected content root hash cannot identify an acknowledged generation",
    );
  }
  if (
    expectedContentRootHash !== undefined &&
    expectedContentRootHash !== acknowledgedRoot?.contentRootHash
  ) {
    throw new PersistenceConflictError(
      `working document root changed from ${expectedContentRootHash} to ${acknowledgedRoot?.contentRootHash ?? "none"}`,
    );
  }
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
  const referencedRevisions = new Set(references.map(({ revisionId }) => revisionId));
  for (const reference of references) {
    const asset = assetsByRevision.get(reference.revisionId);
    if (
      !asset ||
      asset.reference.assetId !== reference.assetId ||
      asset.reference.byteLength !== reference.byteLength
    ) {
      throw new PersistenceMigrationError(`missing detached binary asset: ${reference.revisionId}`);
    }
  }
  if (referencedRevisions.size !== assetsByRevision.size) {
    throw new PersistenceMigrationError("detached binary asset set must exactly match references");
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

export async function migrateWorkingDocumentRecord(
  record: WorkingDocumentRecord,
  assets: readonly DetachedBinaryAsset[] = [],
): Promise<WorkingDocumentRecord> {
  await verifyDetachedWorkingDocument(record, assets);
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
  private readonly acknowledgedRoots = new Map<string, AcknowledgedRoot>();

  constructor(private readonly options: AtomicWorkingDocumentPersistenceOptions = {}) {
    if (
      options.maxBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
    ) {
      throw new PersistenceQuotaError("maxBytes must be a non-negative safe integer");
    }
  }

  async save(
    record: WorkingDocumentRecord,
    assets: readonly DetachedBinaryAsset[],
    options: SaveWorkingDocumentOptions = {},
  ): Promise<void> {
    validateDetachedWorkingDocument(record, assets);
    let candidate: DetachedWorkingDocument;
    try {
      candidate = cloneDetachedDocument({ record, assets });
    } catch {
      throw new PersistenceContractError("working document could not be detached");
    }
    await verifyDetachedWorkingDocument(candidate.record, candidate.assets);
    const byteLength =
      new TextEncoder().encode(JSON.stringify(candidate.record)).byteLength +
      candidate.assets.reduce((total, asset) => total + asset.bytes.byteLength, 0);
    if (this.options.maxBytes !== undefined && byteLength > this.options.maxBytes) {
      throw new PersistenceQuotaError(
        `working document requires ${byteLength} bytes; quota is ${this.options.maxBytes}`,
      );
    }

    const acknowledgedRoot = this.acknowledgedRoots.get(candidate.record.documentId);
    const acknowledged = acknowledgedRoot && this.committedRoots.get(acknowledgedRoot.rootKey);
    assertExpectedAcknowledgement(
      candidate.record.documentId,
      options.expectedAcknowledgement,
      acknowledgedRoot,
    );
    assertExpectedContentRootHash(options.expectedContentRootHash, acknowledgedRoot);
    if (acknowledged && candidate.record.contentSequence <= acknowledged.record.contentSequence) {
      throw new PersistenceConflictError(
        `working document sequence ${candidate.record.contentSequence} conflicts with acknowledged sequence ${acknowledged.record.contentSequence}`,
      );
    }

    const rootKey = durableRootKey(
      candidate.record.documentId,
      candidate.record.contentSequence,
      candidate.record.contentRootHash,
    );
    this.stagedAssets.set(rootKey, candidate.assets);
    this.afterBoundary("asset", candidate.record.contentRootHash);
    this.stagedRecords.set(rootKey, { ...candidate.record, commitState: "staged" });
    this.afterBoundary("staged-record", candidate.record.contentRootHash);

    const stagedRecord = this.stagedRecords.get(rootKey);
    const stagedAssets = this.stagedAssets.get(rootKey);
    if (!stagedRecord || !stagedAssets) {
      throw new PersistenceContractError("staged persistence root is incomplete");
    }
    this.committedRoots.set(
      rootKey,
      cloneDetachedDocument({
        record: { ...stagedRecord, commitState: "committed" },
        assets: stagedAssets,
      }),
    );
    this.afterBoundary("committed-record", candidate.record.contentRootHash);

    this.acknowledgedRoots.set(candidate.record.documentId, {
      rootKey,
      contentSequence: candidate.record.contentSequence,
      contentRootHash: candidate.record.contentRootHash,
    });
    this.afterBoundary("ack", candidate.record.contentRootHash);
  }

  recover(documentId: string): DetachedWorkingDocument | undefined {
    const acknowledgedRoot = this.acknowledgedRoots.get(documentId);
    const acknowledged = acknowledgedRoot
      ? this.committedRoots.get(acknowledgedRoot.rootKey)
      : undefined;
    if (acknowledged?.record.documentId === documentId) {
      return cloneDetachedDocument(acknowledged);
    }

    const latest = [...this.committedRoots.values()]
      .filter(({ record }) => record.documentId === documentId)
      .sort(
        (left, right) =>
          right.record.contentSequence - left.record.contentSequence ||
          right.record.updatedAt - left.record.updatedAt,
      )
      .at(0);
    return latest ? cloneDetachedDocument(latest) : undefined;
  }

  private afterBoundary(boundary: PersistenceDurableBoundary, contentRootHash: string): void {
    (this.options.onDurableBoundary ?? this.options.onBoundary)?.(boundary, contentRootHash);
  }
}

export function estimateJsonOverhead(payload: Readonly<Record<string, unknown>>): number {
  assertJsonValue(payload);
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  return jsonBytes - new TextEncoder().encode(JSON.stringify(Object.values(payload))).byteLength;
}

// Runtime validation intentionally checks untyped caller input.
// oxlint-disable-next-line complexity
export function validateWorkingDocumentRecord(
  record: unknown,
): asserts record is WorkingDocumentRecord {
  if (
    !isPlainRecord(record) ||
    Reflect.ownKeys(record).length !== WORKING_DOCUMENT_RECORD_KEYS.size ||
    Reflect.ownKeys(record).some(
      (key) => typeof key !== "string" || !WORKING_DOCUMENT_RECORD_KEYS.has(key),
    )
  ) {
    throw new PersistenceContractError("working document has unknown record keys");
  }
  assertJsonValue(record);
  if (
    record.schema !== "openpencil-working-document-v1" ||
    record.schemaVersion !== 1 ||
    typeof record.documentId !== "string" ||
    !record.documentId ||
    typeof record.contentRootHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record.contentRootHash)
  ) {
    throw new PersistenceContractError("invalid working-document identity");
  }
  if (
    typeof record.contentSequence !== "number" ||
    !Number.isSafeInteger(record.contentSequence) ||
    record.contentSequence < 0
  ) {
    throw new PersistenceContractError("invalid content sequence");
  }
  if (
    typeof record.historySequence !== "number" ||
    !Number.isSafeInteger(record.historySequence) ||
    record.historySequence < 0
  ) {
    throw new PersistenceContractError("invalid history sequence");
  }
  const viewport = record.viewport;
  if (
    !isPlainRecord(viewport) ||
    typeof viewport.panX !== "number" ||
    typeof viewport.panY !== "number" ||
    typeof viewport.zoom !== "number"
  ) {
    throw new PersistenceContractError("invalid viewport");
  }
  assertFinite(viewport.panX, "viewport.panX");
  assertFinite(viewport.panY, "viewport.panY");
  if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0)
    throw new PersistenceContractError("viewport.zoom must be positive");
  if (typeof record.updatedAt !== "number" || !Number.isFinite(record.updatedAt))
    throw new PersistenceContractError("updatedAt must be finite");
  if (
    !Array.isArray(record.selectionIds) ||
    record.selectionIds.some((selectionId) => typeof selectionId !== "string") ||
    (record.commitState !== "staged" && record.commitState !== "committed") ||
    !isPlainRecord(record.payload)
  ) {
    throw new PersistenceContractError("invalid working-document state");
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
  const recovered = candidates
    .slice()
    .sort(
      (left, right) =>
        right.contentSequence - left.contentSequence || right.updatedAt - left.updatedAt,
    )
    .at(0);
  return recovered ? structuredClone(recovered) : undefined;
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
