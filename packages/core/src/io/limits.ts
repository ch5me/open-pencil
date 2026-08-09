export interface IOInputLimits {
  readonly maxInputBytes?: number;
  readonly maxDecodedBytes?: number;
  readonly maxExpansionRatio?: number;
}

export class IOHostileInputError extends Error {
  readonly code = "io-hostile-input";
}

export class IOCancelledError extends Error {
  readonly code = "io-import-cancelled";
}

export function throwIfIOCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new IOCancelledError("IO import cancelled");
}

export function assertDecodedWithinLimits(
  compressedBytes: number,
  decodedBytes: number,
  limits: IOInputLimits = {},
): void {
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes < 0) {
    throw new IOHostileInputError("decoded input size is invalid");
  }
  if (limits.maxDecodedBytes !== undefined) {
    if (!Number.isSafeInteger(limits.maxDecodedBytes) || limits.maxDecodedBytes < 0) {
      throw new IOHostileInputError("maxDecodedBytes must be a non-negative safe integer");
    }
    if (decodedBytes > limits.maxDecodedBytes) {
      throw new IOHostileInputError(
        `decoded input exceeds maxDecodedBytes: ${decodedBytes} > ${limits.maxDecodedBytes}`,
      );
    }
  }
  if (limits.maxExpansionRatio !== undefined) {
    if (!Number.isFinite(limits.maxExpansionRatio) || limits.maxExpansionRatio < 0) {
      throw new IOHostileInputError("maxExpansionRatio must be a non-negative number");
    }
    if (decodedBytes / Math.max(1, compressedBytes) > limits.maxExpansionRatio) {
      throw new IOHostileInputError("compressed input expansion exceeds limits");
    }
  }
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] * 0x1000000)
  );
}

/** Check ZIP entry totals before fflate allocates decompressed entries. */
export function assertZipDecodedWithinLimits(bytes: Uint8Array, limits: IOInputLimits = {}): void {
  const searchStart = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset--) {
    if (readU32(bytes, offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return;

  const entryCount = readU16(bytes, eocd + 10);
  const centralSize = readU32(bytes, eocd + 12);
  const centralOffset = readU32(bytes, eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new IOHostileInputError("ZIP64 input is not supported by safety limits");
  }
  if (centralOffset + centralSize > bytes.length) {
    throw new IOHostileInputError("ZIP central directory exceeds input");
  }

  let offset = centralOffset;
  let decodedTotal = 0;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > bytes.length || readU32(bytes, offset) !== 0x02014b50) {
      throw new IOHostileInputError("ZIP central directory is truncated");
    }
    const compressed = readU32(bytes, offset + 20);
    const decoded = readU32(bytes, offset + 24);
    if (decoded === 0xffffffff || compressed === 0xffffffff) {
      throw new IOHostileInputError("ZIP64 entry is not supported by safety limits");
    }
    decodedTotal += decoded;
    if (!Number.isSafeInteger(decodedTotal)) {
      throw new IOHostileInputError("ZIP decoded input size is invalid");
    }
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assertDecodedWithinLimits(bytes.length, decodedTotal, limits);
}
