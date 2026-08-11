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
  override readonly name: string = "PersistenceContractError";
  readonly code: string = "E_IMAGE_PERSISTENCE_CONTRACT";
}

export class PersistenceQuotaError extends PersistenceContractError {
  override readonly name = "PersistenceQuotaError";
  override readonly code = "E_IMAGE_PERSISTENCE_QUOTA";
}

export class PersistenceMigrationError extends PersistenceContractError {
  override readonly name = "PersistenceMigrationError";
  override readonly code = "E_IMAGE_PERSISTENCE_MIGRATION";
}

export class PersistenceConflictError extends PersistenceContractError {
  override readonly name = "PersistenceConflictError";
  override readonly code = "E_IMAGE_PERSISTENCE_CONFLICT";
}

export class PersistenceTerminationError extends PersistenceContractError {
  override readonly name = "PersistenceTerminationError";
  override readonly code = "E_IMAGE_PERSISTENCE_TERMINATED";

  constructor(
    readonly boundary: PersistenceDurableBoundary,
    readonly seed: number,
  ) {
    super(`persistence terminated after ${boundary} for seed ${seed}`);
  }
}

type PersistenceError =
  | PersistenceConflictError
  | PersistenceContractError
  | PersistenceMigrationError
  | PersistenceQuotaError
  | PersistenceTerminationError;

function isPersistenceError(error: unknown): error is PersistenceError {
  try {
    return error instanceof PersistenceContractError;
  } catch {
    return false;
  }
}

function normalizePersistenceError(error: unknown, fallback: () => PersistenceError): never {
  if (isPersistenceError(error)) throw error;
  throw fallback();
}

const IMAGE_DATA_URL_PREFIX = /^data:image\//iu;
const PNG_DATA_URL_PREFIX = /^data:image\/png(?:;[^,]*)?,/iu;
const BASE64_PNG_DATA_URL = /^data:image\/png;base64,([a-z\d+/]*={0,2})$/iu;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_IHDR_LENGTH = 13;
const PNG_CHUNK_OVERHEAD = 12;
const PNG_MIN_BYTE_LENGTH =
  PNG_SIGNATURE.length +
  PNG_CHUNK_OVERHEAD +
  PNG_IHDR_LENGTH +
  PNG_CHUNK_OVERHEAD +
  PNG_CHUNK_OVERHEAD;
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return crc >>> 0;
});
const PERSISTENCE_STATE_VALUES: ReadonlySet<string> = new Set([
  "SUPPORTED",
  "UNKNOWN",
  "UNSUPPORTED",
]);
const PERSISTENCE_RECEIPT_STATE_KEYS = new Set([
  "streamingArchive",
  "schemaMigration",
  "indexedDbWorkingDocument",
  "atomicSave",
  "deduplication",
  "viewportPersistence",
  "selectionHistorySeparation",
  "crashRecovery",
]);
const SAVE_WORKING_DOCUMENT_OPTION_KEYS = new Set(["expectedAcknowledgement"]);
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
const WORKING_DOCUMENT_VIEWPORT_KEYS = new Set(["panX", "panY", "zoom"]);
const DETACHED_BINARY_ASSET_KEYS = new Set(["reference", "bytes"]);
const DETACHED_BINARY_ASSET_REFERENCE_KEYS = new Set([
  "kind",
  "assetId",
  "revisionId",
  "mimeType",
  "byteLength",
]);

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new PersistenceContractError(`${label} must be finite`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  const ownKeys = Reflect.ownKeys(record);
  return (
    ownKeys.length === keys.size && ownKeys.every((key) => typeof key === "string" && keys.has(key))
  );
}

function hasExactDataProperties(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
): boolean {
  return (
    hasExactKeys(record, keys) &&
    [...keys].every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    })
  );
}

function assertAllowedDataProperties(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Reflect.ownKeys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      typeof key !== "string" ||
      !keys.has(key) ||
      !descriptor?.enumerable ||
      !("value" in descriptor)
    ) {
      throw new PersistenceContractError(`${label} has unknown or unsafe keys`);
    }
  }
}

function assertDensePlainRecordArray(
  value: unknown,
  elementKeys: ReadonlySet<string>,
  label: string,
): asserts value is readonly Record<string, unknown>[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length),
    )
  ) {
    throw new PersistenceContractError(`${label} must be a dense array`);
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (
      !descriptor?.enumerable ||
      !("value" in descriptor) ||
      !isPlainRecord(descriptor.value) ||
      !hasExactDataProperties(descriptor.value, elementKeys)
    ) {
      throw new PersistenceContractError(`${label} must contain exact plain-object elements`);
    }
  }
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
    if (IMAGE_DATA_URL_PREFIX.test(key)) {
      throw new PersistenceContractError(
        "working-document payload keys must not contain image data URLs",
      );
    }
    assertJsonValue(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

function containsImageDataUrl(value: unknown): boolean {
  if (typeof value === "string") return IMAGE_DATA_URL_PREFIX.test(value);
  if (Array.isArray(value)) return value.some(containsImageDataUrl);
  return isPlainRecord(value) && Object.values(value).some(containsImageDataUrl);
}

function pngChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset + 4] ?? 0,
    bytes[offset + 5] ?? 0,
    bytes[offset + 6] ?? 0,
    bytes[offset + 7] ?? 0,
  );
}

function readPngUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      (bytes[offset + 1] ?? 0) * 0x10000 +
      (bytes[offset + 2] ?? 0) * 0x100 +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function pngCrc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) {
    crc = (PNG_CRC_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertPngChunkType(bytes: Uint8Array, offset: number, type: string): void {
  const typeBytes = bytes.subarray(offset + 4, offset + 8);
  const isAsciiLetter = (byte: number) =>
    (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);
  if (
    typeBytes.length !== 4 ||
    [...typeBytes].some((byte) => !isAsciiLetter(byte)) ||
    (typeBytes[2] ?? 0) > 0x5a ||
    ((typeBytes[0] ?? 0) <= 0x5a && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type))
  ) {
    throw new PersistenceMigrationError("PNG chunk type is invalid");
  }
}

function assertPngIhdr(bytes: Uint8Array, dataOffset: number): number {
  const width = readPngUint32(bytes, dataOffset);
  const height = readPngUint32(bytes, dataOffset + 4);
  const bitDepth = bytes[dataOffset + 8] ?? 0;
  const colorType = bytes[dataOffset + 9] ?? 0;
  const validDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (
    width === 0 ||
    width > 0x7fffffff ||
    height === 0 ||
    height > 0x7fffffff ||
    !validDepths[colorType]?.includes(bitDepth) ||
    bytes[dataOffset + 10] !== 0 ||
    bytes[dataOffset + 11] !== 0 ||
    ((bytes[dataOffset + 12] ?? 2) !== 0 && bytes[dataOffset + 12] !== 1)
  ) {
    throw new PersistenceMigrationError("PNG IHDR fields are invalid");
  }
  return colorType;
}

interface PngChunkState {
  colorType: number;
  sawPlte: boolean;
  sawIdat: boolean;
  idatEnded: boolean;
}

function assertPngPlte(length: number, state: PngChunkState): void {
  if (
    state.sawPlte ||
    state.sawIdat ||
    state.colorType === 0 ||
    state.colorType === 4 ||
    length === 0 ||
    length > 768 ||
    length % 3 !== 0
  ) {
    throw new PersistenceMigrationError("PNG PLTE chunk is invalid or misordered");
  }
  state.sawPlte = true;
}

function acceptPngChunk(
  type: string,
  length: number,
  chunkEnd: number,
  byteLength: number,
  state: PngChunkState,
): boolean {
  if (type === "IHDR") throw new PersistenceMigrationError("PNG IHDR chunk is duplicated");
  if (type === "PLTE") {
    assertPngPlte(length, state);
  } else if (type === "IDAT") {
    if (state.idatEnded) {
      throw new PersistenceMigrationError("PNG IDAT chunks must be consecutive");
    }
    state.sawIdat = true;
  } else if (state.sawIdat) {
    state.idatEnded = true;
  }
  if (type !== "IEND") return false;
  if (
    length !== 0 ||
    !state.sawIdat ||
    (state.colorType === 3 && !state.sawPlte) ||
    chunkEnd !== byteLength
  ) {
    throw new PersistenceMigrationError("PNG IEND chunk must be empty and terminal");
  }
  return true;
}

function assertPngStructure(bytes: Uint8Array): void {
  if (
    bytes.byteLength < PNG_MIN_BYTE_LENGTH ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new PersistenceMigrationError("PNG bytes have an invalid signature or structure");
  }

  let offset: number = PNG_SIGNATURE.length;
  const state: PngChunkState = {
    colorType: -1,
    sawPlte: false,
    sawIdat: false,
    idatEnded: false,
  };
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < PNG_CHUNK_OVERHEAD) {
      throw new PersistenceMigrationError("PNG chunk exceeds byte bounds");
    }
    const length = readPngUint32(bytes, offset);
    const type = pngChunkType(bytes, offset);
    assertPngChunkType(bytes, offset, type);
    if (length > bytes.byteLength - offset - PNG_CHUNK_OVERHEAD) {
      throw new PersistenceMigrationError("PNG chunk exceeds byte bounds");
    }
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const chunkEnd = crcOffset + 4;
    if (pngCrc32(bytes, offset + 4, crcOffset) !== readPngUint32(bytes, crcOffset)) {
      throw new PersistenceMigrationError(`PNG ${type} chunk CRC is invalid`);
    }
    if (offset === PNG_SIGNATURE.length) {
      if (type !== "IHDR" || length !== PNG_IHDR_LENGTH) {
        throw new PersistenceMigrationError("PNG IHDR must be first and exactly 13 bytes");
      }
      state.colorType = assertPngIhdr(bytes, dataOffset);
      offset = chunkEnd;
      continue;
    }
    if (acceptPngChunk(type, length, chunkEnd, bytes.byteLength, state)) return;
    offset = chunkEnd;
  }
  throw new PersistenceMigrationError("PNG bytes are missing a terminal IEND chunk");
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
  assertPngStructure(bytes);
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    throw new PersistenceMigrationError("detached binary asset bytes could not be digested");
  }
}

async function detachJsonValue(
  value: unknown,
  assets: Map<string, DetachedBinaryAsset>,
): Promise<unknown> {
  if (typeof value === "string" && IMAGE_DATA_URL_PREFIX.test(value)) {
    if (!PNG_DATA_URL_PREFIX.test(value)) {
      throw new PersistenceMigrationError("unsupported image data URL");
    }
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
    !hasExactDataProperties(reference, DETACHED_BINARY_ASSET_REFERENCE_KEYS) ||
    reference.kind !== "detached-binary-asset-v1" ||
    typeof reference.assetId !== "string" ||
    !/^asset:[0-9a-f]{64}$/u.test(reference.assetId) ||
    typeof reference.revisionId !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(reference.revisionId) ||
    reference.assetId.slice("asset:".length) !== reference.revisionId.slice("sha256:".length) ||
    reference.mimeType !== "image/png" ||
    typeof reference.byteLength !== "number" ||
    !Number.isSafeInteger(reference.byteLength) ||
    reference.byteLength < PNG_MIN_BYTE_LENGTH
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
  try {
    const reference = {
      kind: "detached-binary-asset-v1",
      assetId,
      revisionId,
      mimeType,
      byteLength,
    };
    assertDetachedReference(reference);
    return reference;
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceMigrationError("detached binary asset reference is invalid"),
    );
  }
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

function isUint8ArrayView(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === "[object Uint8Array]" &&
    "BYTES_PER_ELEMENT" in value &&
    value.BYTES_PER_ELEMENT === 1 &&
    "length" in value &&
    typeof value.length === "number" &&
    value.byteLength === value.length
  );
}

function copyUint8Array(bytes: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
  } catch {
    throw new PersistenceMigrationError("detached binary asset bytes could not be copied");
  }
}

function snapshotValue(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing) return existing;
  if (isUint8ArrayView(value)) return copyUint8Array(value);
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return structuredClone(value);

  let snapshot: object;
  if (Array.isArray(value)) {
    const arraySnapshot: unknown[] = [];
    arraySnapshot.length = value.length;
    snapshot = arraySnapshot;
  } else {
    snapshot = Object.create(Object.getPrototypeOf(value));
  }
  Object.setPrototypeOf(snapshot, Object.getPrototypeOf(value));
  seen.set(value, snapshot);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length" && Array.isArray(value)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    Object.defineProperty(
      snapshot,
      key,
      "value" in descriptor
        ? { ...descriptor, value: snapshotValue(descriptor.value, seen) }
        : descriptor,
    );
  }
  return snapshot;
}

function cloneDetachedAsset(asset: DetachedBinaryAsset): DetachedBinaryAsset {
  return {
    reference: structuredClone(asset.reference),
    bytes: copyUint8Array(asset.bytes),
  };
}

function cloneDetachedDocument(snapshot: DetachedWorkingDocument): DetachedWorkingDocument {
  return {
    record: structuredClone(snapshot.record),
    assets: snapshot.assets.map(cloneDetachedAsset),
  };
}

function snapshotDetachedDocument(record: unknown, assets: unknown): DetachedWorkingDocument {
  let recordSnapshot: unknown;
  try {
    recordSnapshot = snapshotValue(record);
  } catch {
    throw new PersistenceContractError("working document could not be detached");
  }

  assertDensePlainRecordArray(assets, DETACHED_BINARY_ASSET_KEYS, "detached binary assets");
  const assetSnapshots = assets.map((asset) => {
    let reference: unknown;
    try {
      reference = snapshotValue(asset.reference);
    } catch {
      throw new PersistenceMigrationError("invalid detached binary asset reference");
    }
    let bytes: unknown;
    try {
      bytes = isUint8ArrayView(asset.bytes)
        ? copyUint8Array(asset.bytes)
        : snapshotValue(asset.bytes);
    } catch {
      throw new PersistenceMigrationError("detached binary asset bytes could not be snapshotted");
    }
    return { reference, bytes };
  });

  validateDetachedWorkingDocument(
    recordSnapshot as WorkingDocumentRecord,
    assetSnapshots as readonly DetachedBinaryAsset[],
  );
  return {
    record: recordSnapshot as WorkingDocumentRecord,
    assets: assetSnapshots as readonly DetachedBinaryAsset[],
  };
}

function snapshotWorkingDocumentRecord(record: unknown): WorkingDocumentRecord {
  let snapshot: unknown;
  try {
    snapshot = snapshotValue(record);
  } catch (error) {
    normalizePersistenceError(
      error,
      () => new PersistenceContractError("working document could not be snapshotted"),
    );
  }
  validateWorkingDocumentRecord(snapshot);
  return snapshot;
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
  identity: unknown,
): asserts identity is AcknowledgedWorkingDocumentIdentity {
  assertJsonValue(identity);
  if (!isPlainRecord(identity)) {
    throw new PersistenceContractError("expected acknowledgement identity is invalid");
  }
  const contentSequence = identity.contentSequence;
  const contentRootHash = identity.contentRootHash;
  if (
    Reflect.ownKeys(identity).length !== 3 ||
    typeof contentSequence !== "number" ||
    !Number.isSafeInteger(contentSequence) ||
    contentSequence < 0 ||
    typeof contentRootHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(contentRootHash) ||
    identity.rootKey !== durableRootKey(documentId, contentSequence, contentRootHash)
  ) {
    throw new PersistenceContractError("expected acknowledgement identity is invalid");
  }
}

export function createAcknowledgedWorkingDocumentIdentity(
  documentId: string,
  contentSequence: number,
  contentRootHash: string,
): AcknowledgedWorkingDocumentIdentity {
  try {
    const identity = {
      contentSequence,
      contentRootHash,
      rootKey: durableRootKey(documentId, contentSequence, contentRootHash),
    };
    assertAcknowledgementIdentity(documentId, identity);
    return identity;
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError("acknowledgement identity is invalid"),
    );
  }
}

function assertExpectedAcknowledgement(
  documentId: string,
  expectedAcknowledgement: AcknowledgedWorkingDocumentIdentity | undefined,
  acknowledgedRoot: AcknowledgedRoot | undefined,
): void {
  if (expectedAcknowledgement === undefined) {
    if (acknowledgedRoot) {
      throw new PersistenceConflictError(
        `working document acknowledgement is required for sequence ${acknowledgedRoot.contentSequence} root ${acknowledgedRoot.contentRootHash}`,
      );
    }
    return;
  }
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

function snapshotSaveOptions(
  documentId: string,
  options: SaveWorkingDocumentOptions,
): AcknowledgedWorkingDocumentIdentity | undefined {
  try {
    if (!isPlainRecord(options)) {
      throw new PersistenceContractError("save options must be a plain object");
    }
    assertAllowedDataProperties(options, SAVE_WORKING_DOCUMENT_OPTION_KEYS, "save options");
    const expectedAcknowledgement = Object.getOwnPropertyDescriptor(
      options,
      "expectedAcknowledgement",
    )?.value;
    if (expectedAcknowledgement === undefined) return undefined;
    const snapshot = snapshotValue(expectedAcknowledgement);
    assertAcknowledgementIdentity(documentId, snapshot);
    return snapshot;
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError("save options are invalid"),
    );
  }
}

export async function detachPngDataUrls(
  record: WorkingDocumentRecord,
): Promise<DetachedWorkingDocument> {
  try {
    const snapshot = snapshotWorkingDocumentRecord(record);
    const assets = new Map<string, DetachedBinaryAsset>();
    const payload = await detachJsonValue(snapshot.payload, assets);
    if (!isPlainRecord(payload)) {
      throw new PersistenceMigrationError("working-document payload must be a JSON object");
    }
    const detached = {
      record: { ...snapshot, payload },
      assets: [...assets.values()].map(cloneDetachedAsset),
    };
    await verifyDetachedWorkingDocumentSnapshot(detached);
    return cloneDetachedDocument(detached);
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError("working document could not be detached"),
    );
  }
}

export function validateDetachedWorkingDocument(
  record: WorkingDocumentRecord,
  assets: readonly DetachedBinaryAsset[],
): void {
  try {
    validateWorkingDocumentRecord(record);
    assertDensePlainRecordArray(assets, DETACHED_BINARY_ASSET_KEYS, "detached binary assets");
    if (containsImageDataUrl(record.payload)) {
      throw new PersistenceMigrationError("working document contains an embedded image data URL");
    }

    const assetsByRevision = new Map<string, DetachedBinaryAsset>();
    for (const asset of assets) {
      assertDetachedReference(asset.reference);
      if (!isUint8ArrayView(asset.bytes) || asset.bytes.byteLength !== asset.reference.byteLength) {
        throw new PersistenceMigrationError(
          `detached binary asset bytes do not match reference: ${asset.reference.assetId}`,
        );
      }
      assertPngStructure(asset.bytes);
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
        throw new PersistenceMigrationError(
          `missing detached binary asset: ${reference.revisionId}`,
        );
      }
    }
    if (referencedRevisions.size !== assetsByRevision.size) {
      throw new PersistenceMigrationError(
        "detached binary asset set must exactly match references",
      );
    }
  } catch (error) {
    normalizePersistenceError(
      error,
      () => new PersistenceMigrationError("detached working document is invalid"),
    );
  }
}

async function verifyDetachedWorkingDocumentSnapshot(
  snapshot: DetachedWorkingDocument,
): Promise<void> {
  validateDetachedWorkingDocument(snapshot.record, snapshot.assets);
  for (const asset of snapshot.assets) {
    if (`sha256:${await sha256(asset.bytes)}` !== asset.reference.revisionId) {
      throw new PersistenceMigrationError(
        `detached binary asset digest does not match reference: ${asset.reference.assetId}`,
      );
    }
  }
}

export async function verifyDetachedWorkingDocument(
  record: WorkingDocumentRecord,
  assets: readonly DetachedBinaryAsset[],
): Promise<void> {
  try {
    const snapshot = snapshotDetachedDocument(record, assets);
    await verifyDetachedWorkingDocumentSnapshot(snapshot);
  } catch (error) {
    normalizePersistenceError(
      error,
      () => new PersistenceMigrationError("detached working document could not be verified"),
    );
  }
}

export async function migrateWorkingDocumentRecord(
  record: WorkingDocumentRecord,
  assets: readonly DetachedBinaryAsset[] = [],
): Promise<WorkingDocumentRecord> {
  try {
    const snapshot = snapshotDetachedDocument(record, assets);
    await verifyDetachedWorkingDocumentSnapshot(snapshot);
    return structuredClone(snapshot.record);
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceMigrationError("working document could not be migrated"),
    );
  }
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
  private readonly options: AtomicWorkingDocumentPersistenceOptions;

  constructor(options: AtomicWorkingDocumentPersistenceOptions = {}) {
    try {
      const maxBytes = options.maxBytes;
      const onDurableBoundary = options.onDurableBoundary;
      const onBoundary = options.onBoundary;
      if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
        throw new PersistenceQuotaError("maxBytes must be a non-negative safe integer");
      }
      if (
        (onDurableBoundary !== undefined && typeof onDurableBoundary !== "function") ||
        (onBoundary !== undefined && typeof onBoundary !== "function")
      ) {
        throw new PersistenceContractError("persistence boundary hooks must be functions");
      }
      this.options = { maxBytes, onDurableBoundary, onBoundary };
    } catch (error) {
      normalizePersistenceError(
        error,
        () => new PersistenceContractError("persistence options are invalid"),
      );
    }
  }

  async save(
    record: WorkingDocumentRecord,
    assets: readonly DetachedBinaryAsset[],
    options: SaveWorkingDocumentOptions = {},
  ): Promise<void> {
    try {
      const candidate = snapshotDetachedDocument(record, assets);
      const expectedAcknowledgement = snapshotSaveOptions(candidate.record.documentId, options);
      await verifyDetachedWorkingDocumentSnapshot(candidate);
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
        expectedAcknowledgement,
        acknowledgedRoot,
      );
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
    } catch (error) {
      normalizePersistenceError(
        error,
        () => new PersistenceContractError("working document could not be saved"),
      );
    }
  }

  recover(documentId: string): DetachedWorkingDocument | undefined {
    try {
      assertDocumentId(documentId);
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
    } catch (error) {
      return normalizePersistenceError(
        error,
        () => new PersistenceContractError("working document could not be recovered"),
      );
    }
  }

  private afterBoundary(boundary: PersistenceDurableBoundary, contentRootHash: string): void {
    (this.options.onDurableBoundary ?? this.options.onBoundary)?.(boundary, contentRootHash);
  }
}

export function estimateJsonOverhead(payload: Readonly<Record<string, unknown>>): number {
  try {
    assertJsonValue(payload);
    const jsonBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    return jsonBytes - new TextEncoder().encode(JSON.stringify(Object.values(payload))).byteLength;
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError("json overhead could not be estimated"),
    );
  }
}

// Runtime validation intentionally checks untyped caller input.
// oxlint-disable-next-line complexity
export function validateWorkingDocumentRecord(
  record: unknown,
): asserts record is WorkingDocumentRecord {
  try {
    if (!isPlainRecord(record) || !hasExactKeys(record, WORKING_DOCUMENT_RECORD_KEYS)) {
      throw new PersistenceContractError("working document has unknown record keys");
    }
    assertJsonValue(record);
    if (
      Object.entries(record).some(
        ([key, value]) => key !== "payload" && containsImageDataUrl(value),
      )
    ) {
      throw new PersistenceContractError(
        "working document metadata must not contain image data URLs",
      );
    }
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
      !hasExactKeys(viewport, WORKING_DOCUMENT_VIEWPORT_KEYS) ||
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
  } catch (error) {
    normalizePersistenceError(
      error,
      () => new PersistenceContractError("working document is invalid"),
    );
  }
}

function assertDocumentId(documentId: unknown): asserts documentId is string {
  if (typeof documentId !== "string" || !documentId) {
    throw new PersistenceContractError("documentId must be a non-empty string");
  }
}

/**
 * Recovers only the acknowledged generation from a non-atomic record list.
 * Detached assets are not available here; use AtomicWorkingDocumentPersistence for full recovery.
 */
export function recoverWorkingDocument(
  records: readonly WorkingDocumentRecord[],
  documentId: string,
  acknowledgedIdentity: AcknowledgedWorkingDocumentIdentity,
): WorkingDocumentRecord | undefined {
  try {
    assertDocumentId(documentId);
    assertDensePlainRecordArray(records, WORKING_DOCUMENT_RECORD_KEYS, "working document records");
    const recordSnapshots = records.map((record) => snapshotWorkingDocumentRecord(record));
    const identitySnapshot = snapshotValue(acknowledgedIdentity);
    assertAcknowledgementIdentity(documentId, identitySnapshot);
    const candidates = recordSnapshots.filter(
      (record) =>
        record.documentId === documentId &&
        record.commitState === "committed" &&
        record.contentSequence === identitySnapshot.contentSequence &&
        record.contentRootHash === identitySnapshot.contentRootHash,
    );
    if (candidates.some(({ payload }) => containsImageDataUrl(payload))) {
      throw new PersistenceMigrationError(
        "record-only recovery cannot recover embedded image data URLs",
      );
    }
    const recovered = candidates
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .at(0);
    return recovered ? structuredClone(recovered) : undefined;
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError("working document could not be recovered"),
    );
  }
}

export function createPersistenceContractReceipt(
  overrides: Partial<Omit<PersistenceContractReceipt, "version" | "jsonOverheadBytes">> = {},
  jsonOverheadBytes = 0,
): PersistenceContractReceipt {
  try {
    if (!isPlainRecord(overrides)) {
      throw new PersistenceContractError("persistence receipt overrides must be a plain object");
    }
    assertAllowedDataProperties(
      overrides,
      PERSISTENCE_RECEIPT_STATE_KEYS,
      "persistence receipt overrides",
    );
    const snapshot = Object.fromEntries(
      Reflect.ownKeys(overrides).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(overrides, key)?.value,
      ]),
    );
    if (
      Object.values(snapshot).some(
        (state) => typeof state !== "string" || !PERSISTENCE_STATE_VALUES.has(state),
      )
    ) {
      throw new PersistenceContractError("persistence receipt state is invalid");
    }
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
      ...snapshot,
    };
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError("persistence receipt could not be created"),
    );
  }
}
