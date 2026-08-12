/* oxlint-disable max-lines */

import { Unzlib } from 'fflate'

export type PersistenceState = 'SUPPORTED' | 'UNKNOWN' | 'UNSUPPORTED'

export interface DetachedBinaryAssetReference {
  readonly kind: 'detached-binary-asset-v1'
  readonly assetId: `asset:${string}`
  readonly revisionId: `sha256:${string}`
  readonly mimeType: 'image/png'
  readonly byteLength: number
}

export interface DetachedBinaryAsset {
  readonly reference: DetachedBinaryAssetReference
  readonly bytes: Uint8Array
}

export type DurableBinaryAsset = DetachedBinaryAsset

export interface WorkingDocumentRecord {
  readonly schema: 'openpencil-working-document-v1'
  readonly schemaVersion: 1
  readonly documentId: string
  readonly contentSequence: number
  readonly contentRootHash: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly viewport: {
    readonly panX: number
    readonly panY: number
    readonly zoom: number
  }
  readonly selectionIds: readonly string[]
  readonly historySequence: number
  readonly commitState: 'staged' | 'committed'
  readonly updatedAt: number
}

interface BinaryWorkingDocument<TAsset> {
  readonly record: WorkingDocumentRecord
  readonly assets: readonly TAsset[]
}

export type DetachedWorkingDocument = BinaryWorkingDocument<DetachedBinaryAsset>

export type RecoveredWorkingDocument = DetachedWorkingDocument

interface StoredBinaryAsset {
  readonly reference: DetachedBinaryAssetReference
  readonly bytes: ArrayBuffer
}

type StoredWorkingDocument = BinaryWorkingDocument<StoredBinaryAsset>

export const PERSISTENCE_DURABLE_BOUNDARIES = [
  'asset',
  'staged-record',
  'committed-record',
  'ack'
] as const

export type PersistenceDurableBoundary = (typeof PERSISTENCE_DURABLE_BOUNDARIES)[number]

export type PersistenceBoundaryHook = (
  boundary: PersistenceDurableBoundary,
  contentRootHash: string
) => void

export interface AtomicWorkingDocumentPersistenceOptions {
  readonly maxBytes?: number
  readonly maxEncodedAssetBytes?: number
  readonly maxDecodedAssetBytes?: number
  readonly maxAggregateEncodedBytes?: number
  readonly maxAggregateDecodedBytes?: number
  readonly onDurableBoundary?: PersistenceBoundaryHook
  readonly onBoundary?: PersistenceBoundaryHook
}

export type AtomicPersistenceOptions = AtomicWorkingDocumentPersistenceOptions

export interface PersistenceAdmissionOptions {
  readonly maxEncodedAssetBytes?: number
  readonly maxDecodedAssetBytes?: number
  readonly maxAggregateEncodedBytes?: number
  readonly maxAggregateDecodedBytes?: number
}

export interface AcknowledgedWorkingDocumentIdentity {
  readonly contentSequence: number
  readonly contentRootHash: string
  readonly rootKey: string
}

export interface SaveWorkingDocumentOptions {
  readonly expectedAcknowledgement?: AcknowledgedWorkingDocumentIdentity
}

export interface PersistenceContractReceipt {
  readonly version: 'persistence-v1'
  readonly jsonOverheadBytes: number
  readonly streamingArchive: PersistenceState
  readonly schemaMigration: PersistenceState
  readonly indexedDbWorkingDocument: PersistenceState
  readonly atomicSave: PersistenceState
  readonly deduplication: PersistenceState
  readonly viewportPersistence: PersistenceState
  readonly selectionHistorySeparation: PersistenceState
  readonly crashRecovery: PersistenceState
}

export class PersistenceContractError extends Error {
  override readonly name: string = 'PersistenceContractError'
  readonly code: string = 'E_IMAGE_PERSISTENCE_CONTRACT'
}

export class PersistenceQuotaError extends PersistenceContractError {
  override readonly name = 'PersistenceQuotaError'
  override readonly code = 'E_IMAGE_PERSISTENCE_QUOTA'
}

export class PersistenceMigrationError extends PersistenceContractError {
  override readonly name = 'PersistenceMigrationError'
  override readonly code = 'E_IMAGE_PERSISTENCE_MIGRATION'
}

export class PersistenceConflictError extends PersistenceContractError {
  override readonly name = 'PersistenceConflictError'
  override readonly code = 'E_IMAGE_PERSISTENCE_CONFLICT'
}

export class PersistenceTerminationError extends PersistenceContractError {
  override readonly name = 'PersistenceTerminationError'
  override readonly code = 'E_IMAGE_PERSISTENCE_TERMINATED'

  constructor(
    readonly boundary: PersistenceDurableBoundary,
    readonly seed: number
  ) {
    super(`persistence terminated after ${boundary} for seed ${seed}`)
  }
}

type PersistenceError =
  | PersistenceConflictError
  | PersistenceContractError
  | PersistenceMigrationError
  | PersistenceQuotaError
  | PersistenceTerminationError

function isPersistenceError(error: unknown): error is PersistenceError {
  try {
    return error instanceof PersistenceContractError
  } catch {
    return false
  }
}

function normalizePersistenceError(error: unknown, fallback: () => PersistenceError): never {
  if (isPersistenceError(error)) throw error
  throw fallback()
}

const IMAGE_DATA_URL_PREFIX = /^data:image\//iu
const PNG_DATA_URL_PREFIX = /^data:image\/png(?:;[^,]*)?,/iu
const BASE64_PNG_DATA_URL = /^data:image\/png;base64,([a-z\d+/]*={0,2})$/iu
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const PNG_IHDR_LENGTH = 13
const PNG_CHUNK_OVERHEAD = 12
const PNG_MIN_BYTE_LENGTH =
  PNG_SIGNATURE.length +
  PNG_CHUNK_OVERHEAD +
  PNG_IHDR_LENGTH +
  PNG_CHUNK_OVERHEAD +
  PNG_CHUNK_OVERHEAD
const MEBIBYTE = 1024 * 1024
const DEFAULT_PERSISTENCE_ADMISSION_LIMITS = {
  maxEncodedAssetBytes: 96 * MEBIBYTE,
  maxDecodedAssetBytes: 64 * MEBIBYTE,
  maxAggregateEncodedBytes: 384 * MEBIBYTE,
  maxAggregateDecodedBytes: 256 * MEBIBYTE
} as const
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return crc >>> 0
})
const PERSISTENCE_STATE_VALUES: ReadonlySet<string> = new Set([
  'SUPPORTED',
  'UNKNOWN',
  'UNSUPPORTED'
])
const PERSISTENCE_RECEIPT_STATE_KEYS = new Set([
  'streamingArchive',
  'schemaMigration',
  'indexedDbWorkingDocument',
  'atomicSave',
  'deduplication',
  'viewportPersistence',
  'selectionHistorySeparation',
  'crashRecovery'
])
const SAVE_WORKING_DOCUMENT_OPTION_KEYS = new Set(['expectedAcknowledgement'])
const ACKNOWLEDGED_IDENTITY_KEYS = new Set(['contentSequence', 'contentRootHash', 'rootKey'])
const PERSISTENCE_ADMISSION_OPTION_KEYS: ReadonlySet<keyof PersistenceAdmissionOptions> = new Set([
  'maxEncodedAssetBytes',
  'maxDecodedAssetBytes',
  'maxAggregateEncodedBytes',
  'maxAggregateDecodedBytes'
])
const ATOMIC_PERSISTENCE_OPTION_KEYS = new Set([
  'maxBytes',
  ...PERSISTENCE_ADMISSION_OPTION_KEYS,
  'onDurableBoundary',
  'onBoundary'
])
const WORKING_DOCUMENT_RECORD_KEYS = new Set([
  'schema',
  'schemaVersion',
  'documentId',
  'contentSequence',
  'contentRootHash',
  'payload',
  'viewport',
  'selectionIds',
  'historySequence',
  'commitState',
  'updatedAt'
])
const WORKING_DOCUMENT_VIEWPORT_KEYS = new Set(['panX', 'panY', 'zoom'])
const DETACHED_BINARY_ASSET_KEYS = new Set(['reference', 'bytes'])
const DETACHED_BINARY_ASSET_REFERENCE_KEYS = new Set([
  'kind',
  'assetId',
  'revisionId',
  'mimeType',
  'byteLength'
])

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new PersistenceContractError(`${label} must be finite`)
}

function assertDocumentId(documentId: unknown): asserts documentId is string {
  if (typeof documentId !== 'string' || !documentId) {
    throw new PersistenceContractError('documentId must be a non-empty string')
  }
}

function assertContentSequence(contentSequence: unknown): asserts contentSequence is number {
  if (
    typeof contentSequence !== 'number' ||
    !Number.isSafeInteger(contentSequence) ||
    contentSequence < 0
  ) {
    throw new PersistenceContractError('content sequence must be a non-negative safe integer')
  }
}

function assertContentRootHash(contentRootHash: unknown): asserts contentRootHash is string {
  if (typeof contentRootHash !== 'string' || !/^[0-9a-f]{64}$/u.test(contentRootHash)) {
    throw new PersistenceContractError('contentRootHash must be 64 lowercase hexadecimal digits')
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(record: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  const ownKeys = Reflect.ownKeys(record)
  return (
    ownKeys.length === keys.size && ownKeys.every((key) => typeof key === 'string' && keys.has(key))
  )
}

function hasExactDataProperties(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>
): boolean {
  return (
    hasExactKeys(record, keys) &&
    [...keys].every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key)
      return descriptor?.enumerable === true && 'value' in descriptor
    })
  )
}

function assertAllowedDataProperties(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
  label: string
): void {
  for (const key of Reflect.ownKeys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (
      typeof key !== 'string' ||
      !keys.has(key) ||
      !descriptor?.enumerable ||
      !('value' in descriptor)
    ) {
      throw new PersistenceContractError(`${label} has unknown or unsafe keys`)
    }
  }
}

type PersistenceAdmissionLimits = Required<PersistenceAdmissionOptions>

function normalizeAdmissionOptions(
  options: PersistenceAdmissionOptions,
  exact = true
): PersistenceAdmissionLimits {
  if (!isPlainRecord(options)) {
    throw new PersistenceContractError('persistence admission options must be a plain object')
  }
  if (exact) {
    assertAllowedDataProperties(
      options,
      PERSISTENCE_ADMISSION_OPTION_KEYS,
      'persistence admission options'
    )
  }
  const limits = { ...DEFAULT_PERSISTENCE_ADMISSION_LIMITS }
  for (const key of PERSISTENCE_ADMISSION_OPTION_KEYS) {
    const value = Object.getOwnPropertyDescriptor(options, key)?.value
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new PersistenceQuotaError(`${key} must be a non-negative safe integer`)
    }
    limits[key] = value
  }
  return limits
}

interface PersistenceAdmissionState {
  encodedBytes: number
  decodedBytes: number
}

function addAdmissionBytes(
  state: PersistenceAdmissionState,
  key: keyof PersistenceAdmissionState,
  bytes: number,
  limit: number,
  label: string
): void {
  if (bytes > limit || state[key] > limit - bytes) {
    throw new PersistenceQuotaError(`${label} exceeds ${limit} bytes`)
  }
  state[key] += bytes
}

function assertDensePlainRecordArray(
  value: unknown,
  elementKeys: ReadonlySet<string>,
  label: string
): asserts value is readonly Record<string, unknown>[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).some(
      (key) =>
        key !== 'length' &&
        (typeof key !== 'string' || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length)
    )
  ) {
    throw new PersistenceContractError(`${label} must be a dense array`)
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      !isPlainRecord(descriptor.value) ||
      !hasExactDataProperties(descriptor.value, elementKeys)
    ) {
      throw new PersistenceContractError(`${label} must contain exact plain-object elements`)
    }
  }
}

function isDetachedReference(value: unknown): value is DetachedBinaryAssetReference {
  return isPlainRecord(value) && value.kind === 'detached-binary-asset-v1'
}

// oxlint-disable-next-line complexity
function assertJsonValue(value: unknown, ancestors = new Set<object>()): void {
  const primitive =
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0))
  if (primitive) return
  if (typeof value !== 'object')
    throw new PersistenceContractError('working-document payload must contain JSON values')
  if (ancestors.has(value))
    throw new PersistenceContractError('working-document payload must not contain cycles')
  ancestors.add(value)
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).some(
        (key) =>
          key !== 'length' &&
          (typeof key !== 'string' || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length)
      ) ||
      Array.from({ length: value.length }, (_, index) => index).some(
        (index) => !Object.hasOwn(value, index)
      )
    ) {
      throw new PersistenceContractError('working-document payload arrays must be dense')
    }
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new PersistenceContractError('working-document payload has non-JSON properties')
      }
      assertJsonValue(descriptor.value, ancestors)
    }
    ancestors.delete(value)
    return
  }
  if (!isPlainRecord(value))
    throw new PersistenceContractError('working-document payload must contain plain objects')
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) {
      throw new PersistenceContractError('working-document payload has non-JSON properties')
    }
    if (IMAGE_DATA_URL_PREFIX.test(key)) {
      throw new PersistenceContractError(
        'working-document payload keys must not contain image data URLs'
      )
    }
    assertJsonValue(descriptor.value, ancestors)
  }
  ancestors.delete(value)
}

function containsImageDataUrl(value: unknown): boolean {
  if (typeof value === 'string') return IMAGE_DATA_URL_PREFIX.test(value)
  if (Array.isArray(value)) return value.some(containsImageDataUrl)
  return isPlainRecord(value) && Object.values(value).some(containsImageDataUrl)
}

function pngChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset + 4] ?? 0,
    bytes[offset + 5] ?? 0,
    bytes[offset + 6] ?? 0,
    bytes[offset + 7] ?? 0
  )
}

function readPngUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      (bytes[offset + 1] ?? 0) * 0x10000 +
      (bytes[offset + 2] ?? 0) * 0x100 +
      (bytes[offset + 3] ?? 0)) >>>
    0
  )
}

function pngCrc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff
  for (let index = start; index < end; index++) {
    crc = (PNG_CRC_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function assertPngChunkType(bytes: Uint8Array, offset: number, type: string): void {
  const typeBytes = bytes.subarray(offset + 4, offset + 8)
  const isAsciiLetter = (byte: number) =>
    (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)
  if (
    typeBytes.length !== 4 ||
    [...typeBytes].some((byte) => !isAsciiLetter(byte)) ||
    (typeBytes[2] ?? 0) > 0x5a ||
    ((typeBytes[0] ?? 0) <= 0x5a && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type))
  ) {
    throw new PersistenceMigrationError('PNG chunk type is invalid')
  }
}

interface PngImageHeader {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
}

function assertPngIhdr(bytes: Uint8Array, dataOffset: number): PngImageHeader {
  const width = readPngUint32(bytes, dataOffset)
  const height = readPngUint32(bytes, dataOffset + 4)
  const bitDepth = bytes[dataOffset + 8] ?? 0
  const colorType = bytes[dataOffset + 9] ?? 0
  const interlace = bytes[dataOffset + 12] ?? 2
  const validDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  }
  if (
    width === 0 ||
    width > 0x7fffffff ||
    height === 0 ||
    height > 0x7fffffff ||
    !validDepths[colorType]?.includes(bitDepth) ||
    bytes[dataOffset + 10] !== 0 ||
    bytes[dataOffset + 11] !== 0 ||
    (interlace !== 0 && interlace !== 1)
  ) {
    throw new PersistenceMigrationError('PNG IHDR fields are invalid')
  }
  return { width, height, bitDepth, colorType, interlace }
}

interface PngChunkState {
  header: PngImageHeader | undefined
  sawPlte: boolean
  paletteEntries: number
  sawTrns: boolean
  sawIdat: boolean
  idatBytes: number
  idatEnded: boolean
  idatParts: Uint8Array[]
}

function assertPngPlte(length: number, state: PngChunkState): void {
  const header = state.header
  if (
    !header ||
    state.sawPlte ||
    state.sawTrns ||
    state.sawIdat ||
    header.colorType === 0 ||
    header.colorType === 4 ||
    length === 0 ||
    length > 768 ||
    length % 3 !== 0 ||
    (header.colorType === 3 && length / 3 > 2 ** header.bitDepth)
  ) {
    throw new PersistenceMigrationError('PNG PLTE chunk is invalid or misordered')
  }
  state.sawPlte = true
  state.paletteEntries = length / 3
}

function assertPngTrns(length: number, state: PngChunkState): void {
  const header = state.header
  const colorType = header?.colorType
  if (
    state.sawTrns ||
    state.sawIdat ||
    colorType === undefined ||
    colorType === 4 ||
    colorType === 6 ||
    (colorType === 0 && length !== 2) ||
    (colorType === 2 && length !== 6) ||
    (colorType === 3 && (!state.sawPlte || length === 0 || length > state.paletteEntries))
  ) {
    throw new PersistenceMigrationError('PNG tRNS chunk is invalid or misordered')
  }
  state.sawTrns = true
}

function assertPngTrnsData(data: Uint8Array, state: PngChunkState): void {
  assertPngTrns(data.byteLength, state)
  const header = state.header
  if (header?.colorType === 0 && header.bitDepth < 16) {
    const sample = ((data[0] ?? 0) << 8) | (data[1] ?? 0)
    if (sample >= 2 ** header.bitDepth) {
      throw new PersistenceMigrationError('PNG grayscale tRNS sample exceeds bit depth')
    }
  } else if (header?.colorType === 2 && header.bitDepth < 16) {
    for (let offset = 0; offset < data.byteLength; offset += 2) {
      const sample = ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)
      if (sample >= 2 ** header.bitDepth) {
        throw new PersistenceMigrationError('PNG truecolor tRNS sample exceeds bit depth')
      }
    }
  }
}

interface PngPass {
  width: number
  height: number
}

function pngPasses(header: PngImageHeader): readonly PngPass[] {
  if (header.interlace === 0) return [{ width: header.width, height: header.height }]
  const starts = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2]
  ] as const
  return starts.map(([startX, startY, stepX, stepY]) => ({
    width: header.width <= startX ? 0 : Math.ceil((header.width - startX) / stepX),
    height: header.height <= startY ? 0 : Math.ceil((header.height - startY) / stepY)
  }))
}

function pngScanlineByteLength(header: PngImageHeader, limit: number): number {
  const channels: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const bitsPerPixel = header.bitDepth * (channels[header.colorType] ?? 0)
  const scanlineBytes = (width: number) => 1n + (BigInt(width) * BigInt(bitsPerPixel) + 7n) / 8n
  let total = 0n
  if (header.interlace === 0) {
    total = BigInt(header.height) * scanlineBytes(header.width)
  } else {
    for (const { width, height } of pngPasses(header)) {
      if (width > 0 && height > 0) total += BigInt(height) * scanlineBytes(width)
    }
  }
  if (total > BigInt(limit)) {
    throw new PersistenceQuotaError(`decoded PNG scanlines exceed ${limit} bytes`)
  }
  return Number(total)
}

function readPngAdler32(bytes: Uint8Array): number {
  return readPngUint32(bytes, bytes.byteLength - 4)
}

class DeflateBitReader {
  private bitOffset = 16
  private readonly limit: number

  constructor(private readonly bytes: Uint8Array) {
    this.limit = (bytes.byteLength - 4) * 8
  }

  read(bitCount: number): number {
    if (this.bitOffset + bitCount > this.limit) {
      throw new PersistenceMigrationError('PNG IDAT deflate stream is truncated')
    }
    let value = 0
    for (let bit = 0; bit < bitCount; bit++) {
      const byte = this.bytes[this.bitOffset >> 3] ?? 0
      value |= ((byte >> (this.bitOffset & 7)) & 1) << bit
      this.bitOffset++
    }
    return value
  }

  alignToByte(): void {
    this.bitOffset = (this.bitOffset + 7) & ~7
  }

  assertAtTrailer(): void {
    if (Math.ceil(this.bitOffset / 8) !== this.bytes.byteLength - 4) {
      throw new PersistenceMigrationError('PNG IDAT zlib stream has trailing deflate bytes')
    }
  }
}

interface DeflateHuffman {
  readonly maxBits: number
  readonly symbols: ReadonlyMap<number, number>
}

function reverseDeflateBits(value: number, bitCount: number): number {
  let reversed = 0
  for (let bit = 0; bit < bitCount; bit++) {
    reversed = (reversed << 1) | ((value >> bit) & 1)
  }
  return reversed
}

function createDeflateHuffman(lengths: readonly number[]): DeflateHuffman | undefined {
  const maxBits = Math.max(...lengths)
  if (maxBits === 0) return undefined
  const counts = Array.from({ length: maxBits + 1 }, () => 0)
  for (const length of lengths) {
    if (length < 0 || length > 15) {
      throw new PersistenceMigrationError('PNG IDAT Huffman code length is invalid')
    }
    if (length > 0) counts[length] = (counts[length] ?? 0) + 1
  }
  let available = 1
  for (let bits = 1; bits <= maxBits; bits++) {
    available = available * 2 - (counts[bits] ?? 0)
    if (available < 0) {
      throw new PersistenceMigrationError('PNG IDAT Huffman tree is oversubscribed')
    }
  }

  const nextCode = Array.from({ length: maxBits + 1 }, () => 0)
  let code = 0
  for (let bits = 1; bits <= maxBits; bits++) {
    code = (code + (counts[bits - 1] ?? 0)) << 1
    nextCode[bits] = code
  }
  const symbols = new Map<number, number>()
  lengths.forEach((length, symbol) => {
    if (length === 0) return
    const canonical = nextCode[length] ?? 0
    nextCode[length] = canonical + 1
    symbols.set(length * 0x10000 + reverseDeflateBits(canonical, length), symbol)
  })
  return { maxBits, symbols }
}

function readDeflateSymbol(reader: DeflateBitReader, huffman: DeflateHuffman | undefined): number {
  if (!huffman) throw new PersistenceMigrationError('PNG IDAT Huffman tree is empty')
  let code = 0
  for (let bits = 1; bits <= huffman.maxBits; bits++) {
    code |= reader.read(1) << (bits - 1)
    const symbol = huffman.symbols.get(bits * 0x10000 + code)
    if (symbol !== undefined) return symbol
  }
  throw new PersistenceMigrationError('PNG IDAT Huffman code is invalid')
}

function readDynamicDeflateTrees(
  reader: DeflateBitReader
): readonly [DeflateHuffman, DeflateHuffman | undefined] {
  const literalCount = reader.read(5) + 257
  const distanceCount = reader.read(5) + 1
  const codeLengthCount = reader.read(4) + 4
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
  const codeLengths = Array.from({ length: 19 }, () => 0)
  for (let index = 0; index < codeLengthCount; index++) {
    codeLengths[order[index] ?? 0] = reader.read(3)
  }
  const codeLengthTree = createDeflateHuffman(codeLengths)
  const lengths: number[] = []
  while (lengths.length < literalCount + distanceCount) {
    const symbol = readDeflateSymbol(reader, codeLengthTree)
    if (symbol <= 15) {
      lengths.push(symbol)
      continue
    }
    let repeat = 0
    let value: number | undefined
    if (symbol === 16) {
      repeat = reader.read(2) + 3
      value = lengths.at(-1)
    } else if (symbol === 17) {
      repeat = reader.read(3) + 3
      value = 0
    } else if (symbol === 18) {
      repeat = reader.read(7) + 11
      value = 0
    }
    if (
      repeat === 0 ||
      value === undefined ||
      lengths.length + repeat > literalCount + distanceCount
    ) {
      throw new PersistenceMigrationError('PNG IDAT Huffman repeat is invalid')
    }
    lengths.push(...Array.from({ length: repeat }, () => value))
  }
  const literalTree = createDeflateHuffman(lengths.slice(0, literalCount))
  if (!literalTree) throw new PersistenceMigrationError('PNG IDAT literal tree is empty')
  return [literalTree, createDeflateHuffman(lengths.slice(literalCount))]
}

function fixedDeflateTrees(): readonly [DeflateHuffman, DeflateHuffman] {
  const literalLengths = Array.from({ length: 288 }, (_, symbol) => {
    if (symbol <= 143) return 8
    if (symbol <= 255) return 9
    return symbol <= 279 ? 7 : 8
  })
  const literalTree = createDeflateHuffman(literalLengths)
  const distanceTree = createDeflateHuffman(Array.from({ length: 32 }, () => 5))
  if (!literalTree || !distanceTree) {
    throw new PersistenceMigrationError('PNG IDAT fixed Huffman trees are invalid')
  }
  return [literalTree, distanceTree]
}

function assertExactDeflateFraming(compressed: Uint8Array, expectedBytes: number): void {
  const reader = new DeflateBitReader(compressed)
  const lengthBases = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258
  ]
  const lengthExtras = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
  ]
  const distanceBases = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
    3073, 4097, 6145, 8193, 12_289, 16_385, 24_577
  ]
  const distanceExtras = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
  ]
  let decodedBytes = 0
  let finalBlock = false
  while (!finalBlock) {
    finalBlock = reader.read(1) === 1
    const blockType = reader.read(2)
    if (blockType === 0) {
      reader.alignToByte()
      const length = reader.read(16)
      if ((length ^ 0xffff) !== reader.read(16)) {
        throw new PersistenceMigrationError('PNG IDAT stored block length is invalid')
      }
      for (let index = 0; index < length; index++) reader.read(8)
      decodedBytes += length
    } else {
      if (blockType === 3) {
        throw new PersistenceMigrationError('PNG IDAT deflate block type is invalid')
      }
      const [literalTree, distanceTree] =
        blockType === 1 ? fixedDeflateTrees() : readDynamicDeflateTrees(reader)
      let endOfBlock = false
      while (!endOfBlock) {
        const symbol = readDeflateSymbol(reader, literalTree)
        if (symbol < 256) {
          decodedBytes++
        } else if (symbol === 256) {
          endOfBlock = true
        } else {
          const lengthIndex = symbol - 257
          const lengthBase = lengthBases.at(lengthIndex)
          const lengthExtra = lengthExtras.at(lengthIndex)
          if (lengthBase === undefined || lengthExtra === undefined) {
            throw new PersistenceMigrationError('PNG IDAT length code is invalid')
          }
          const length = lengthBase + reader.read(lengthExtra)
          const distanceSymbol = readDeflateSymbol(reader, distanceTree)
          const distanceBase = distanceBases.at(distanceSymbol)
          const distanceExtra = distanceExtras.at(distanceSymbol)
          if (distanceBase === undefined || distanceExtra === undefined) {
            throw new PersistenceMigrationError('PNG IDAT distance code is invalid')
          }
          const distance = distanceBase + reader.read(distanceExtra)
          if (distance > decodedBytes) {
            throw new PersistenceMigrationError('PNG IDAT distance exceeds decoded data')
          }
          decodedBytes += length
        }
        if (decodedBytes > expectedBytes) {
          throw new PersistenceMigrationError('PNG decoded scanline size is invalid')
        }
      }
    }
    if (decodedBytes > expectedBytes) {
      throw new PersistenceMigrationError('PNG decoded scanline size is invalid')
    }
  }
  reader.assertAtTrailer()
  if (decodedBytes !== expectedBytes) {
    throw new PersistenceMigrationError('PNG decoded scanline size is invalid')
  }
}

function paethPredictor(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  return upDistance <= upperLeftDistance ? up : upperLeft
}

function unfilterPngRow(
  filter: number,
  raw: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number
): Uint8Array {
  const row = new Uint8Array(raw.byteLength)
  for (let index = 0; index < raw.byteLength; index++) {
    const left = index < bytesPerPixel ? 0 : (row[index - bytesPerPixel] ?? 0)
    const up = previous[index] ?? 0
    const upperLeft = index < bytesPerPixel ? 0 : (previous[index - bytesPerPixel] ?? 0)
    let predictor = 0
    if (filter === 1) predictor = left
    else if (filter === 2) predictor = up
    else if (filter === 3) predictor = Math.floor((left + up) / 2)
    else if (filter === 4) predictor = paethPredictor(left, up, upperLeft)
    row[index] = ((raw[index] ?? 0) + predictor) & 0xff
  }
  return row
}

function assertIndexedPngSamples(
  row: Uint8Array,
  width: number,
  bitDepth: number,
  paletteEntries: number
): void {
  const mask = 2 ** bitDepth - 1
  for (let sampleIndex = 0; sampleIndex < width; sampleIndex++) {
    const bitOffset = sampleIndex * bitDepth
    const byte = row[Math.floor(bitOffset / 8)] ?? 0
    const shift = 8 - bitDepth - (bitOffset % 8)
    if (((byte >> shift) & mask) >= paletteEntries) {
      throw new PersistenceMigrationError('PNG indexed sample exceeds palette')
    }
  }
}

function assertPngScanlines(decoded: Uint8Array, state: PngChunkState): void {
  const header = state.header
  if (!header) throw new PersistenceMigrationError('PNG header is missing')
  const channels: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const bitsPerPixel = header.bitDepth * (channels[header.colorType] ?? 0)
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8))
  let offset = 0
  for (const pass of pngPasses(header)) {
    if (pass.width === 0 || pass.height === 0) continue
    const rowBytes = Math.ceil((pass.width * bitsPerPixel) / 8)
    let previous: Uint8Array = new Uint8Array(rowBytes)
    for (let rowIndex = 0; rowIndex < pass.height; rowIndex++) {
      const filter = decoded[offset] ?? 5
      offset++
      if (filter > 4) throw new PersistenceMigrationError('PNG scanline filter is invalid')
      const raw = decoded.subarray(offset, offset + rowBytes)
      offset += rowBytes
      if (header.colorType !== 3) continue
      previous = unfilterPngRow(filter, raw, previous, bytesPerPixel)
      assertIndexedPngSamples(previous, pass.width, header.bitDepth, state.paletteEntries)
    }
  }
}

function assertPngImageData(state: PngChunkState, limit: number): void {
  const header = state.header
  if (!header || state.idatBytes === 0) {
    throw new PersistenceMigrationError('PNG IDAT stream must be non-empty')
  }
  const expectedBytes = pngScanlineByteLength(header, limit)
  const compressed = new Uint8Array(state.idatBytes)
  let offset = 0
  for (const part of state.idatParts) {
    compressed.set(part, offset)
    offset += part.byteLength
  }
  if (
    compressed.byteLength < 6 ||
    (compressed[0] ?? 0) % 16 !== 8 ||
    (compressed[0] ?? 0) >> 4 > 7 ||
    (((compressed[0] ?? 0) << 8) | (compressed[1] ?? 0)) % 31 !== 0 ||
    ((compressed[1] ?? 0) & 0x20) !== 0
  ) {
    throw new PersistenceMigrationError('PNG IDAT zlib framing is invalid')
  }
  assertExactDeflateFraming(compressed, expectedBytes)

  let decodedBytes = 0
  const decoded = new Uint8Array(expectedBytes)
  let adlerA = 1
  let adlerB = 0
  try {
    const inflater = new Unzlib((chunk) => {
      if (chunk.byteLength > expectedBytes - decodedBytes) {
        throw new PersistenceMigrationError('PNG decoded scanline size is invalid')
      }
      decoded.set(chunk, decodedBytes)
      decodedBytes += chunk.byteLength
      for (const byte of chunk) {
        adlerA = (adlerA + byte) % 65521
        adlerB = (adlerB + adlerA) % 65521
      }
    })
    inflater.push(compressed, true)
  } catch (error) {
    normalizePersistenceError(
      error,
      () => new PersistenceMigrationError('PNG IDAT zlib stream is invalid')
    )
  }
  if (
    decodedBytes !== expectedBytes ||
    ((adlerB << 16) | adlerA) >>> 0 !== readPngAdler32(compressed)
  ) {
    throw new PersistenceMigrationError('PNG decoded scanline size or zlib checksum is invalid')
  }
  assertPngScanlines(decoded, state)
}

function acceptPngChunk(
  type: string,
  length: number,
  data: Uint8Array,
  chunkEnd: number,
  byteLength: number,
  state: PngChunkState,
  decodedByteLimit: number
): boolean {
  if (type === 'IHDR') throw new PersistenceMigrationError('PNG IHDR chunk is duplicated')
  if (type === 'PLTE') {
    assertPngPlte(length, state)
  } else if (type === 'tRNS') {
    assertPngTrnsData(data, state)
  } else if (type === 'IDAT') {
    if (state.idatEnded) {
      throw new PersistenceMigrationError('PNG IDAT chunks must be consecutive')
    }
    if (state.header?.colorType === 3 && !state.sawPlte) {
      throw new PersistenceMigrationError('indexed PNG PLTE must precede IDAT')
    }
    state.sawIdat = true
    state.idatBytes += length
    state.idatParts.push(data)
  } else if (state.sawIdat) {
    state.idatEnded = true
  }
  if (type !== 'IEND') return false
  if (length !== 0 || !state.sawIdat || chunkEnd !== byteLength) {
    throw new PersistenceMigrationError('PNG IEND chunk must be empty and terminal')
  }
  assertPngImageData(state, decodedByteLimit)
  return true
}

function assertPngStructure(bytes: Uint8Array, decodedByteLimit: number): void {
  if (
    bytes.byteLength < PNG_MIN_BYTE_LENGTH ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new PersistenceMigrationError('PNG bytes have an invalid signature or structure')
  }

  let offset: number = PNG_SIGNATURE.length
  const state: PngChunkState = {
    header: undefined,
    sawPlte: false,
    paletteEntries: 0,
    sawTrns: false,
    sawIdat: false,
    idatBytes: 0,
    idatEnded: false,
    idatParts: []
  }
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < PNG_CHUNK_OVERHEAD) {
      throw new PersistenceMigrationError('PNG chunk exceeds byte bounds')
    }
    const length = readPngUint32(bytes, offset)
    const type = pngChunkType(bytes, offset)
    assertPngChunkType(bytes, offset, type)
    if (length > bytes.byteLength - offset - PNG_CHUNK_OVERHEAD) {
      throw new PersistenceMigrationError('PNG chunk exceeds byte bounds')
    }
    const dataOffset = offset + 8
    const crcOffset = dataOffset + length
    const chunkEnd = crcOffset + 4
    if (pngCrc32(bytes, offset + 4, crcOffset) !== readPngUint32(bytes, crcOffset)) {
      throw new PersistenceMigrationError(`PNG ${type} chunk CRC is invalid`)
    }
    if (offset === PNG_SIGNATURE.length) {
      if (type !== 'IHDR' || length !== PNG_IHDR_LENGTH) {
        throw new PersistenceMigrationError('PNG IHDR must be first and exactly 13 bytes')
      }
      state.header = assertPngIhdr(bytes, dataOffset)
      offset = chunkEnd
      continue
    }
    if (
      acceptPngChunk(
        type,
        length,
        bytes.subarray(dataOffset, crcOffset),
        chunkEnd,
        bytes.byteLength,
        state,
        decodedByteLimit
      )
    ) {
      return
    }
    offset = chunkEnd
  }
  throw new PersistenceMigrationError('PNG bytes are missing a terminal IEND chunk')
}

function estimateBase64DecodedBytes(base64: string): number {
  let padding = 0
  if (base64.endsWith('==')) padding = 2
  else if (base64.endsWith('=')) padding = 1
  return (base64.length / 4) * 3 - padding
}

function inspectPngDataUrl(dataUrl: string, limits: PersistenceAdmissionLimits): string {
  const match = BASE64_PNG_DATA_URL.exec(dataUrl)
  if (!match?.[1]) {
    throw new PersistenceMigrationError('PNG data URL must use valid base64 encoding')
  }
  if (match[1].length % 4 !== 0) {
    throw new PersistenceMigrationError('PNG data URL must use padded base64 encoding')
  }
  const encodedBytes = match[1].length
  const decodedBytes = estimateBase64DecodedBytes(match[1])
  if (encodedBytes > limits.maxEncodedAssetBytes) {
    throw new PersistenceQuotaError(
      `encoded PNG asset exceeds ${limits.maxEncodedAssetBytes} bytes`
    )
  }
  if (decodedBytes > limits.maxDecodedAssetBytes) {
    throw new PersistenceQuotaError(
      `decoded PNG asset exceeds ${limits.maxDecodedAssetBytes} bytes`
    )
  }
  return match[1]
}

function collectPngAdmission(
  value: unknown,
  limits: PersistenceAdmissionLimits,
  admission: PersistenceAdmissionState
): void {
  if (typeof value === 'string' && IMAGE_DATA_URL_PREFIX.test(value)) {
    if (!PNG_DATA_URL_PREFIX.test(value)) {
      throw new PersistenceMigrationError('unsupported image data URL')
    }
    const base64 = inspectPngDataUrl(value, limits)
    addAdmissionBytes(
      admission,
      'encodedBytes',
      base64.length,
      limits.maxAggregateEncodedBytes,
      'aggregate encoded PNG assets'
    )
    addAdmissionBytes(
      admission,
      'decodedBytes',
      estimateBase64DecodedBytes(base64),
      limits.maxAggregateDecodedBytes,
      'aggregate decoded PNG assets'
    )
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPngAdmission(item, limits, admission)
    return
  }
  if (isPlainRecord(value)) {
    for (const item of Object.values(value)) collectPngAdmission(item, limits, admission)
  }
}

function decodePngDataUrl(dataUrl: string, limits: PersistenceAdmissionLimits): Uint8Array {
  const base64 = inspectPngDataUrl(dataUrl, limits)
  let binary: string
  try {
    binary = atob(base64)
  } catch {
    throw new PersistenceMigrationError('PNG data URL contains invalid base64')
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  assertPngStructure(bytes, limits.maxDecodedAssetBytes)
  return bytes
}

async function sha256(bytes: Uint8Array): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    throw new PersistenceMigrationError('detached binary asset bytes could not be digested')
  }
}

async function detachJsonValue(
  value: unknown,
  assets: Map<string, DetachedBinaryAsset>,
  limits: PersistenceAdmissionLimits
): Promise<unknown> {
  if (typeof value === 'string' && IMAGE_DATA_URL_PREFIX.test(value)) {
    if (!PNG_DATA_URL_PREFIX.test(value)) {
      throw new PersistenceMigrationError('unsupported image data URL')
    }
    const bytes = decodePngDataUrl(value, limits)
    const digest = await sha256(bytes)
    const reference: DetachedBinaryAssetReference = {
      kind: 'detached-binary-asset-v1',
      assetId: `asset:${digest}`,
      revisionId: `sha256:${digest}`,
      mimeType: 'image/png',
      byteLength: bytes.byteLength
    }
    if (!assets.has(reference.revisionId)) assets.set(reference.revisionId, { reference, bytes })
    return reference
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => detachJsonValue(item, assets, limits)))
  }
  if (isPlainRecord(value)) {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [
        key,
        await detachJsonValue(item, assets, limits)
      ])
    )
    return Object.fromEntries(entries)
  }
  throw new PersistenceMigrationError('working-document payload must contain JSON values')
}

function assertDetachedReference(
  reference: unknown
): asserts reference is DetachedBinaryAssetReference {
  if (
    !isPlainRecord(reference) ||
    !hasExactDataProperties(reference, DETACHED_BINARY_ASSET_REFERENCE_KEYS) ||
    reference.kind !== 'detached-binary-asset-v1' ||
    typeof reference.assetId !== 'string' ||
    !/^asset:[0-9a-f]{64}$/u.test(reference.assetId) ||
    typeof reference.revisionId !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(reference.revisionId) ||
    reference.assetId.slice('asset:'.length) !== reference.revisionId.slice('sha256:'.length) ||
    reference.mimeType !== 'image/png' ||
    typeof reference.byteLength !== 'number' ||
    !Number.isSafeInteger(reference.byteLength) ||
    reference.byteLength < PNG_MIN_BYTE_LENGTH
  ) {
    throw new PersistenceMigrationError('invalid detached binary asset reference')
  }
}

export function createDetachedBinaryAssetReference(
  assetId: string,
  revisionId: string,
  mimeType: string,
  byteLength: number
): DetachedBinaryAssetReference {
  try {
    const reference = {
      kind: 'detached-binary-asset-v1',
      assetId,
      revisionId,
      mimeType,
      byteLength
    }
    assertDetachedReference(reference)
    return reference
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceMigrationError('detached binary asset reference is invalid')
    )
  }
}

function collectDetachedReferences(
  value: unknown,
  references: DetachedBinaryAssetReference[]
): void {
  if (isDetachedReference(value)) {
    assertDetachedReference(value)
    references.push(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDetachedReferences(item, references))
    return
  }
  if (isPlainRecord(value)) {
    Object.values(value).forEach((item) => collectDetachedReferences(item, references))
  }
}

function isUint8ArrayView(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Uint8Array]' &&
    'BYTES_PER_ELEMENT' in value &&
    value.BYTES_PER_ELEMENT === 1 &&
    'length' in value &&
    typeof value.length === 'number' &&
    value.byteLength === value.length
  )
}

function copyUint8Array(bytes: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice()
  } catch {
    throw new PersistenceMigrationError('detached binary asset bytes could not be copied')
  }
}

function assertDetachedAssetAdmission(
  assets: readonly Record<string, unknown>[],
  limits: PersistenceAdmissionLimits
): void {
  let aggregateBytes = 0
  for (const asset of assets) {
    assertDetachedReference(asset.reference)
    const bytes = asset.bytes
    if (!isUint8ArrayView(bytes) || bytes.byteLength !== asset.reference.byteLength) {
      throw new PersistenceMigrationError(
        `detached binary asset bytes do not match reference: ${asset.reference.assetId}`
      )
    }
    if (bytes.byteLength > limits.maxDecodedAssetBytes) {
      throw new PersistenceQuotaError(
        `decoded PNG asset exceeds ${limits.maxDecodedAssetBytes} bytes`
      )
    }
    if (aggregateBytes > limits.maxAggregateDecodedBytes - bytes.byteLength) {
      throw new PersistenceQuotaError(
        `aggregate decoded PNG assets exceed ${limits.maxAggregateDecodedBytes} bytes`
      )
    }
    aggregateBytes += bytes.byteLength
  }
}

function snapshotValue(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (value === null || typeof value !== 'object') return value
  const existing = seen.get(value)
  if (existing) return existing
  if (isUint8ArrayView(value)) return copyUint8Array(value)
  if (value instanceof ArrayBuffer) return value.slice(0)
  if (ArrayBuffer.isView(value)) return structuredClone(value)

  let snapshot: object
  if (Array.isArray(value)) {
    const arraySnapshot: unknown[] = []
    arraySnapshot.length = value.length
    snapshot = arraySnapshot
  } else {
    snapshot = Object.create(Object.getPrototypeOf(value))
  }
  Object.setPrototypeOf(snapshot, Object.getPrototypeOf(value))
  seen.set(value, snapshot)
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length' && Array.isArray(value)) continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) continue
    Object.defineProperty(
      snapshot,
      key,
      'value' in descriptor
        ? { ...descriptor, value: snapshotValue(descriptor.value, seen) }
        : descriptor
    )
  }
  return snapshot
}

function cloneDetachedAsset(asset: DetachedBinaryAsset): DetachedBinaryAsset {
  return {
    reference: structuredClone(asset.reference),
    bytes: copyUint8Array(asset.bytes)
  }
}

function cloneDetachedDocument(snapshot: DetachedWorkingDocument): DetachedWorkingDocument {
  return {
    record: structuredClone(snapshot.record),
    assets: snapshot.assets.map(cloneDetachedAsset)
  }
}

function storeDetachedAsset(asset: DetachedBinaryAsset): StoredBinaryAsset {
  const bytes = new ArrayBuffer(asset.bytes.byteLength)
  new Uint8Array(bytes).set(asset.bytes)
  return {
    reference: structuredClone(asset.reference),
    bytes
  }
}

function restoreStoredDocument(snapshot: StoredWorkingDocument): DetachedWorkingDocument {
  return {
    record: structuredClone(snapshot.record),
    assets: snapshot.assets.map((asset) => ({
      reference: structuredClone(asset.reference),
      bytes: new Uint8Array(asset.bytes.slice(0))
    }))
  }
}

function snapshotDetachedDocument(
  record: unknown,
  assets: unknown,
  limits: PersistenceAdmissionLimits
): DetachedWorkingDocument {
  let recordSnapshot: unknown
  try {
    recordSnapshot = snapshotValue(record)
  } catch {
    throw new PersistenceContractError('working document could not be detached')
  }

  assertDensePlainRecordArray(assets, DETACHED_BINARY_ASSET_KEYS, 'detached binary assets')
  assertDetachedAssetAdmission(assets, limits)
  const assetSnapshots = assets.map((asset) => {
    let reference: unknown
    try {
      reference = snapshotValue(asset.reference)
    } catch {
      throw new PersistenceMigrationError('invalid detached binary asset reference')
    }
    let bytes: unknown
    try {
      bytes = isUint8ArrayView(asset.bytes)
        ? copyUint8Array(asset.bytes)
        : snapshotValue(asset.bytes)
    } catch {
      throw new PersistenceMigrationError('detached binary asset bytes could not be snapshotted')
    }
    assertDetachedReference(reference)
    if (!isUint8ArrayView(bytes)) {
      throw new PersistenceMigrationError('detached binary asset bytes could not be snapshotted')
    }
    return { reference, bytes }
  })

  validateWorkingDocumentRecord(recordSnapshot)
  validateDetachedWorkingDocumentSnapshot(recordSnapshot, assetSnapshots, limits)
  return {
    record: recordSnapshot,
    assets: assetSnapshots
  }
}

function snapshotWorkingDocumentRecord(record: unknown): WorkingDocumentRecord {
  let snapshot: unknown
  try {
    snapshot = snapshotValue(record)
  } catch (error) {
    normalizePersistenceError(
      error,
      () => new PersistenceContractError('working document could not be snapshotted')
    )
  }
  validateWorkingDocumentRecord(snapshot)
  return snapshot
}

function durableRootKey(
  documentId: string,
  contentSequence: number,
  contentRootHash: string
): string {
  return `${documentId}\0${contentSequence}\0${contentRootHash}`
}

type AcknowledgedRoot = AcknowledgedWorkingDocumentIdentity

function assertAcknowledgementIdentity(
  documentId: string,
  identity: unknown
): asserts identity is AcknowledgedWorkingDocumentIdentity {
  assertDocumentId(documentId)
  assertJsonValue(identity)
  if (!isPlainRecord(identity) || !hasExactDataProperties(identity, ACKNOWLEDGED_IDENTITY_KEYS)) {
    throw new PersistenceContractError('expected acknowledgement identity is invalid')
  }
  const contentSequence = Object.getOwnPropertyDescriptor(identity, 'contentSequence')?.value
  const contentRootHash = Object.getOwnPropertyDescriptor(identity, 'contentRootHash')?.value
  const rootKey = Object.getOwnPropertyDescriptor(identity, 'rootKey')?.value
  assertContentSequence(contentSequence)
  assertContentRootHash(contentRootHash)
  if (
    typeof rootKey !== 'string' ||
    rootKey !== durableRootKey(documentId, contentSequence, contentRootHash)
  ) {
    throw new PersistenceContractError('expected acknowledgement identity is invalid')
  }
}

export function createAcknowledgedWorkingDocumentIdentity(
  documentId: string,
  contentSequence: number,
  contentRootHash: string
): AcknowledgedWorkingDocumentIdentity {
  try {
    assertDocumentId(documentId)
    assertContentSequence(contentSequence)
    assertContentRootHash(contentRootHash)
    const identity = {
      contentSequence,
      contentRootHash,
      rootKey: durableRootKey(documentId, contentSequence, contentRootHash)
    }
    assertAcknowledgementIdentity(documentId, identity)
    return identity
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError('acknowledgement identity is invalid')
    )
  }
}

function assertExpectedAcknowledgement(
  documentId: string,
  expectedAcknowledgement: AcknowledgedWorkingDocumentIdentity | undefined,
  acknowledgedRoot: AcknowledgedRoot | undefined
): void {
  if (expectedAcknowledgement === undefined) {
    if (acknowledgedRoot) {
      throw new PersistenceConflictError(
        `working document acknowledgement is required for sequence ${acknowledgedRoot.contentSequence} root ${acknowledgedRoot.contentRootHash}`
      )
    }
    return
  }
  assertAcknowledgementIdentity(documentId, expectedAcknowledgement)
  if (
    !acknowledgedRoot ||
    expectedAcknowledgement.contentSequence !== acknowledgedRoot.contentSequence ||
    expectedAcknowledgement.contentRootHash !== acknowledgedRoot.contentRootHash ||
    expectedAcknowledgement.rootKey !== acknowledgedRoot.rootKey
  ) {
    throw new PersistenceConflictError(
      `working document acknowledgement changed from sequence ${expectedAcknowledgement.contentSequence} root ${expectedAcknowledgement.contentRootHash} to sequence ${acknowledgedRoot?.contentSequence ?? 'none'} root ${acknowledgedRoot?.contentRootHash ?? 'none'}`
    )
  }
}

function snapshotSaveOptions(
  documentId: string,
  options: SaveWorkingDocumentOptions
): AcknowledgedWorkingDocumentIdentity | undefined {
  try {
    if (!isPlainRecord(options)) {
      throw new PersistenceContractError('save options must be a plain object')
    }
    assertAllowedDataProperties(options, SAVE_WORKING_DOCUMENT_OPTION_KEYS, 'save options')
    const expectedAcknowledgement = Object.getOwnPropertyDescriptor(
      options,
      'expectedAcknowledgement'
    )?.value
    if (expectedAcknowledgement === undefined) return undefined
    const snapshot = snapshotValue(expectedAcknowledgement)
    assertAcknowledgementIdentity(documentId, snapshot)
    return snapshot
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError('save options are invalid')
    )
  }
}

export async function detachPngDataUrls(
  record: WorkingDocumentRecord,
  options: PersistenceAdmissionOptions = {}
): Promise<DetachedWorkingDocument> {
  try {
    const limits = normalizeAdmissionOptions(options)
    const snapshot = snapshotWorkingDocumentRecord(record)
    const assets = new Map<string, DetachedBinaryAsset>()
    collectPngAdmission(snapshot.payload, limits, {
      encodedBytes: 0,
      decodedBytes: 0
    })
    const payload = await detachJsonValue(snapshot.payload, assets, limits)
    if (!isPlainRecord(payload)) {
      throw new PersistenceMigrationError('working-document payload must be a JSON object')
    }
    const detached = {
      record: { ...snapshot, payload },
      assets: [...assets.values()].map(cloneDetachedAsset)
    }
    await verifyDetachedWorkingDocumentSnapshot(detached, limits)
    return cloneDetachedDocument(detached)
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError('working document could not be detached')
    )
  }
}

function validateDetachedWorkingDocumentSnapshot(
  record: WorkingDocumentRecord,
  assets: readonly DetachedBinaryAsset[],
  limits: PersistenceAdmissionLimits
): void {
  validateWorkingDocumentRecord(record)
  assertDensePlainRecordArray(assets, DETACHED_BINARY_ASSET_KEYS, 'detached binary assets')
  assertDetachedAssetAdmission(assets, limits)
  if (containsImageDataUrl(record.payload)) {
    throw new PersistenceMigrationError('working document contains an embedded image data URL')
  }

  const assetsByRevision = new Map<string, DetachedBinaryAsset>()
  for (const asset of assets) {
    assertPngStructure(asset.bytes, limits.maxDecodedAssetBytes)
    if (assetsByRevision.has(asset.reference.revisionId)) {
      throw new PersistenceMigrationError(
        `duplicate detached binary asset revision: ${asset.reference.revisionId}`
      )
    }
    assetsByRevision.set(asset.reference.revisionId, asset)
  }

  const references: DetachedBinaryAssetReference[] = []
  collectDetachedReferences(record.payload, references)
  const referencedRevisions = new Set(references.map(({ revisionId }) => revisionId))
  for (const reference of references) {
    const asset = assetsByRevision.get(reference.revisionId)
    if (
      !asset ||
      asset.reference.assetId !== reference.assetId ||
      asset.reference.byteLength !== reference.byteLength
    ) {
      throw new PersistenceMigrationError(`missing detached binary asset: ${reference.revisionId}`)
    }
  }
  if (referencedRevisions.size !== assetsByRevision.size) {
    throw new PersistenceMigrationError('detached binary asset set must exactly match references')
  }
}

export function validateDetachedWorkingDocument(
  record: WorkingDocumentRecord,
  assets: readonly DetachedBinaryAsset[],
  options: PersistenceAdmissionOptions = {}
): void {
  try {
    validateDetachedWorkingDocumentSnapshot(record, assets, normalizeAdmissionOptions(options))
  } catch (error) {
    normalizePersistenceError(
      error,
      () => new PersistenceMigrationError('detached working document is invalid')
    )
  }
}

async function verifyDetachedWorkingDocumentSnapshot(
  snapshot: DetachedWorkingDocument,
  limits: PersistenceAdmissionLimits
): Promise<void> {
  validateDetachedWorkingDocumentSnapshot(snapshot.record, snapshot.assets, limits)
  for (const asset of snapshot.assets) {
    if (`sha256:${await sha256(asset.bytes)}` !== asset.reference.revisionId) {
      throw new PersistenceMigrationError(
        `detached binary asset digest does not match reference: ${asset.reference.assetId}`
      )
    }
  }
}

export async function verifyDetachedWorkingDocument(
  record: WorkingDocumentRecord,
  assets: readonly DetachedBinaryAsset[],
  options: PersistenceAdmissionOptions = {}
): Promise<void> {
  try {
    const limits = normalizeAdmissionOptions(options)
    const snapshot = snapshotDetachedDocument(record, assets, limits)
    await verifyDetachedWorkingDocumentSnapshot(snapshot, limits)
  } catch (error) {
    normalizePersistenceError(
      error,
      () => new PersistenceMigrationError('detached working document could not be verified')
    )
  }
}

export async function migrateWorkingDocumentRecord(
  record: WorkingDocumentRecord,
  assets: readonly DetachedBinaryAsset[] = [],
  options: PersistenceAdmissionOptions = {}
): Promise<WorkingDocumentRecord> {
  try {
    const limits = normalizeAdmissionOptions(options)
    const snapshot = snapshotDetachedDocument(record, assets, limits)
    await verifyDetachedWorkingDocumentSnapshot(snapshot, limits)
    return structuredClone(snapshot.record)
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceMigrationError('working document could not be migrated')
    )
  }
}

export function createTerminationInjector(
  seed: number,
  contentRootHash?: string
): PersistenceBoundaryHook {
  try {
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new PersistenceContractError('termination seed must be a non-negative safe integer')
    }
    if (contentRootHash !== undefined) assertContentRootHash(contentRootHash)
    const boundary = PERSISTENCE_DURABLE_BOUNDARIES[seed % PERSISTENCE_DURABLE_BOUNDARIES.length]
    return (observedBoundary, observedRootHash) => {
      try {
        if (!PERSISTENCE_DURABLE_BOUNDARIES.includes(observedBoundary)) {
          throw new PersistenceContractError('persistence boundary is invalid')
        }
        assertContentRootHash(observedRootHash)
      } catch (error) {
        normalizePersistenceError(
          error,
          () => new PersistenceContractError('termination injection input is invalid')
        )
      }
      if (
        observedBoundary === boundary &&
        (contentRootHash === undefined || observedRootHash === contentRootHash)
      ) {
        throw new PersistenceTerminationError(boundary, seed)
      }
    }
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError('termination injector is invalid')
    )
  }
}

export class AtomicWorkingDocumentPersistence {
  private readonly stagedAssets = new Map<string, readonly StoredBinaryAsset[]>()
  private readonly stagedRecords = new Map<string, WorkingDocumentRecord>()
  private readonly committedRoots = new Map<string, StoredWorkingDocument>()
  private readonly acknowledgedRoots = new Map<string, AcknowledgedRoot>()
  private readonly options: AtomicWorkingDocumentPersistenceOptions
  private readonly admissionLimits: PersistenceAdmissionLimits

  constructor(options: AtomicWorkingDocumentPersistenceOptions = {}) {
    try {
      if (!isPlainRecord(options)) {
        throw new PersistenceContractError('persistence options must be a plain object')
      }
      assertAllowedDataProperties(options, ATOMIC_PERSISTENCE_OPTION_KEYS, 'persistence options')
      const maxBytes = Object.getOwnPropertyDescriptor(options, 'maxBytes')?.value
      const onDurableBoundary = Object.getOwnPropertyDescriptor(options, 'onDurableBoundary')?.value
      const onBoundary = Object.getOwnPropertyDescriptor(options, 'onBoundary')?.value
      if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
        throw new PersistenceQuotaError('maxBytes must be a non-negative safe integer')
      }
      if (
        (onDurableBoundary !== undefined && typeof onDurableBoundary !== 'function') ||
        (onBoundary !== undefined && typeof onBoundary !== 'function')
      ) {
        throw new PersistenceContractError('persistence boundary hooks must be functions')
      }
      this.admissionLimits = normalizeAdmissionOptions(options, false)
      this.options = {
        ...this.admissionLimits,
        maxBytes,
        onDurableBoundary,
        onBoundary
      }
    } catch (error) {
      normalizePersistenceError(
        error,
        () => new PersistenceContractError('persistence options are invalid')
      )
    }
  }

  async save(
    record: WorkingDocumentRecord,
    assets: readonly DetachedBinaryAsset[],
    options: SaveWorkingDocumentOptions = {}
  ): Promise<void> {
    try {
      const candidate = snapshotDetachedDocument(record, assets, this.admissionLimits)
      const expectedAcknowledgement = snapshotSaveOptions(candidate.record.documentId, options)
      await verifyDetachedWorkingDocumentSnapshot(candidate, this.admissionLimits)
      const byteLength =
        new TextEncoder().encode(JSON.stringify(candidate.record)).byteLength +
        candidate.assets.reduce((total, asset) => total + asset.bytes.byteLength, 0)
      if (this.options.maxBytes !== undefined && byteLength > this.options.maxBytes) {
        throw new PersistenceQuotaError(
          `working document requires ${byteLength} bytes; quota is ${this.options.maxBytes}`
        )
      }

      const acknowledgedRoot = this.acknowledgedRoots.get(candidate.record.documentId)
      const acknowledged = acknowledgedRoot && this.committedRoots.get(acknowledgedRoot.rootKey)
      assertExpectedAcknowledgement(
        candidate.record.documentId,
        expectedAcknowledgement,
        acknowledgedRoot
      )
      if (acknowledged && candidate.record.contentSequence <= acknowledged.record.contentSequence) {
        throw new PersistenceConflictError(
          `working document sequence ${candidate.record.contentSequence} conflicts with acknowledged sequence ${acknowledged.record.contentSequence}`
        )
      }

      const rootKey = durableRootKey(
        candidate.record.documentId,
        candidate.record.contentSequence,
        candidate.record.contentRootHash
      )
      this.stagedAssets.set(rootKey, candidate.assets.map(storeDetachedAsset))
      this.afterBoundary('asset', candidate.record.contentRootHash)
      this.stagedRecords.set(rootKey, { ...candidate.record, commitState: 'staged' })
      this.afterBoundary('staged-record', candidate.record.contentRootHash)

      const stagedRecord = this.stagedRecords.get(rootKey)
      const stagedAssets = this.stagedAssets.get(rootKey)
      if (!stagedRecord || !stagedAssets) {
        throw new PersistenceContractError('staged persistence root is incomplete')
      }
      this.committedRoots.set(rootKey, {
        record: { ...stagedRecord, commitState: 'committed' },
        assets: stagedAssets
      })
      this.afterBoundary('committed-record', candidate.record.contentRootHash)

      this.acknowledgedRoots.set(candidate.record.documentId, {
        rootKey,
        contentSequence: candidate.record.contentSequence,
        contentRootHash: candidate.record.contentRootHash
      })
      this.afterBoundary('ack', candidate.record.contentRootHash)
    } catch (error) {
      normalizePersistenceError(
        error,
        () => new PersistenceContractError('working document could not be saved')
      )
    }
  }

  recover(documentId: string): DetachedWorkingDocument | undefined {
    try {
      assertDocumentId(documentId)
      const acknowledgedRoot = this.acknowledgedRoots.get(documentId)
      const acknowledged = acknowledgedRoot
        ? this.committedRoots.get(acknowledgedRoot.rootKey)
        : undefined
      if (acknowledged?.record.documentId === documentId) {
        return restoreStoredDocument(acknowledged)
      }

      const latest = [...this.committedRoots.values()]
        .filter(({ record }) => record.documentId === documentId)
        .sort(
          (left, right) =>
            right.record.contentSequence - left.record.contentSequence ||
            right.record.updatedAt - left.record.updatedAt
        )
        .at(0)
      return latest ? restoreStoredDocument(latest) : undefined
    } catch (error) {
      return normalizePersistenceError(
        error,
        () => new PersistenceContractError('working document could not be recovered')
      )
    }
  }

  private afterBoundary(boundary: PersistenceDurableBoundary, contentRootHash: string): void {
    ;(this.options.onDurableBoundary ?? this.options.onBoundary)?.(boundary, contentRootHash)
  }
}

export function estimateJsonOverhead(payload: Readonly<Record<string, unknown>>): number {
  try {
    if (!isPlainRecord(payload)) {
      throw new PersistenceContractError('json overhead payload must be a plain object')
    }
    assertJsonValue(payload)
    const jsonBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength
    return jsonBytes - new TextEncoder().encode(JSON.stringify(Object.values(payload))).byteLength
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError('json overhead could not be estimated')
    )
  }
}

// Runtime validation intentionally checks untyped caller input.
// oxlint-disable-next-line complexity
export function validateWorkingDocumentRecord(
  record: unknown
): asserts record is WorkingDocumentRecord {
  try {
    if (!isPlainRecord(record) || !hasExactKeys(record, WORKING_DOCUMENT_RECORD_KEYS)) {
      throw new PersistenceContractError('working document has unknown record keys')
    }
    assertJsonValue(record)
    if (
      Object.entries(record).some(
        ([key, value]) => key !== 'payload' && containsImageDataUrl(value)
      )
    ) {
      throw new PersistenceContractError(
        'working document metadata must not contain image data URLs'
      )
    }
    if (
      record.schema !== 'openpencil-working-document-v1' ||
      record.schemaVersion !== 1 ||
      typeof record.documentId !== 'string' ||
      !record.documentId ||
      typeof record.contentRootHash !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(record.contentRootHash)
    ) {
      throw new PersistenceContractError('invalid working-document identity')
    }
    if (
      typeof record.contentSequence !== 'number' ||
      !Number.isSafeInteger(record.contentSequence) ||
      record.contentSequence < 0
    ) {
      throw new PersistenceContractError('invalid content sequence')
    }
    if (
      typeof record.historySequence !== 'number' ||
      !Number.isSafeInteger(record.historySequence) ||
      record.historySequence < 0
    ) {
      throw new PersistenceContractError('invalid history sequence')
    }
    const viewport = record.viewport
    if (
      !isPlainRecord(viewport) ||
      !hasExactKeys(viewport, WORKING_DOCUMENT_VIEWPORT_KEYS) ||
      typeof viewport.panX !== 'number' ||
      typeof viewport.panY !== 'number' ||
      typeof viewport.zoom !== 'number'
    ) {
      throw new PersistenceContractError('invalid viewport')
    }
    assertFinite(viewport.panX, 'viewport.panX')
    assertFinite(viewport.panY, 'viewport.panY')
    if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0)
      throw new PersistenceContractError('viewport.zoom must be positive')
    if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt))
      throw new PersistenceContractError('updatedAt must be finite')
    if (
      !Array.isArray(record.selectionIds) ||
      record.selectionIds.some((selectionId) => typeof selectionId !== 'string') ||
      (record.commitState !== 'staged' && record.commitState !== 'committed') ||
      !isPlainRecord(record.payload)
    ) {
      throw new PersistenceContractError('invalid working-document state')
    }
  } catch (error) {
    normalizePersistenceError(
      error,
      () => new PersistenceContractError('working document is invalid')
    )
  }
}

/**
 * Recovers only the acknowledged generation from a non-atomic record list.
 * Detached assets are not available here; use AtomicWorkingDocumentPersistence for full recovery.
 */
export function recoverWorkingDocument(
  records: readonly WorkingDocumentRecord[],
  documentId: string,
  acknowledgedIdentity: AcknowledgedWorkingDocumentIdentity
): WorkingDocumentRecord | undefined {
  try {
    assertDocumentId(documentId)
    assertDensePlainRecordArray(records, WORKING_DOCUMENT_RECORD_KEYS, 'working document records')
    const recordSnapshots = records.map((record) => snapshotWorkingDocumentRecord(record))
    const identitySnapshot = snapshotValue(acknowledgedIdentity)
    assertAcknowledgementIdentity(documentId, identitySnapshot)
    const candidates = recordSnapshots.filter(
      (record) =>
        record.documentId === documentId &&
        record.commitState === 'committed' &&
        record.contentSequence === identitySnapshot.contentSequence &&
        record.contentRootHash === identitySnapshot.contentRootHash
    )
    if (candidates.some(({ payload }) => containsImageDataUrl(payload))) {
      throw new PersistenceMigrationError(
        'record-only recovery cannot recover embedded image data URLs'
      )
    }
    const recovered = candidates
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .at(0)
    return recovered ? structuredClone(recovered) : undefined
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError('working document could not be recovered')
    )
  }
}

export function createPersistenceContractReceipt(
  overrides: Partial<Omit<PersistenceContractReceipt, 'version' | 'jsonOverheadBytes'>> = {},
  jsonOverheadBytes = 0
): PersistenceContractReceipt {
  try {
    if (!isPlainRecord(overrides)) {
      throw new PersistenceContractError('persistence receipt overrides must be a plain object')
    }
    assertAllowedDataProperties(
      overrides,
      PERSISTENCE_RECEIPT_STATE_KEYS,
      'persistence receipt overrides'
    )
    const snapshot = Object.fromEntries(
      Reflect.ownKeys(overrides).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(overrides, key)?.value
      ])
    )
    if (
      Object.values(snapshot).some(
        (state) => typeof state !== 'string' || !PERSISTENCE_STATE_VALUES.has(state)
      )
    ) {
      throw new PersistenceContractError('persistence receipt state is invalid')
    }
    if (!Number.isSafeInteger(jsonOverheadBytes) || jsonOverheadBytes < 0) {
      throw new PersistenceContractError('json overhead must be a non-negative safe integer')
    }
    return {
      version: 'persistence-v1',
      jsonOverheadBytes,
      streamingArchive: 'UNKNOWN',
      schemaMigration: 'UNKNOWN',
      indexedDbWorkingDocument: 'UNKNOWN',
      atomicSave: 'UNKNOWN',
      deduplication: 'UNKNOWN',
      viewportPersistence: 'UNKNOWN',
      selectionHistorySeparation: 'UNKNOWN',
      crashRecovery: 'UNKNOWN',
      ...snapshot
    }
  } catch (error) {
    return normalizePersistenceError(
      error,
      () => new PersistenceContractError('persistence receipt could not be created')
    )
  }
}
