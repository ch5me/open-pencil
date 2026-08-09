import {
  DEFAULT_PSD_LIMITS,
  PsdHostileFileError,
  PsdUnsupportedError,
  type PsdExportInput,
  type PsdHeader,
  type PsdImportResult,
  type PsdLimits,
  type PsdLayerMetadata,
  type PsdWarningCode,
} from "./types";

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

export function parsePsdHeader(
  bytes: Uint8Array,
  limits: PsdLimits = DEFAULT_PSD_LIMITS,
): PsdHeader {
  if (bytes.byteLength > limits.maxBytes) throw new PsdHostileFileError("PSD exceeds byte limit");
  if (bytes.byteLength < 26) throw new PsdUnsupportedError("PSD header is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !==
    "8BPS"
  ) {
    throw new PsdUnsupportedError("invalid PSD signature");
  }
  const version = readUint16(view, 4);
  if (version !== 1 && version !== 2)
    throw new PsdUnsupportedError(`unsupported PSD version: ${version}`);
  const header: PsdHeader = {
    version,
    channels: readUint16(view, 12),
    height: readUint32(view, 14),
    width: readUint32(view, 18),
    bitsPerChannel: readUint16(view, 22),
    colorMode: readUint16(view, 24),
  };
  if (header.width > limits.maxWidth || header.height > limits.maxHeight) {
    throw new PsdHostileFileError("PSD dimensions exceed limits");
  }
  const decodedBytes =
    header.width * header.height * header.channels * Math.ceil(header.bitsPerChannel / 8);
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > limits.maxDecodedBytes) {
    throw new PsdHostileFileError("PSD decoded payload exceeds limits");
  }
  return header;
}

function headerWarnings(header: PsdHeader): PsdWarningCode[] {
  const warnings: PsdWarningCode[] = [];
  if (header.colorMode !== 3) warnings.push("unsupported-color-mode");
  if (header.bitsPerChannel !== 8) warnings.push("unsupported-bit-depth");
  return warnings;
}

export function stagePsdImport(
  bytes: Uint8Array,
  limits: PsdLimits = DEFAULT_PSD_LIMITS,
): PsdImportResult {
  const header = parsePsdHeader(bytes, limits);
  const warnings = headerWarnings(header);
  return {
    header,
    layers: [],
    warnings,
    degraded: warnings.length > 0,
    staged: true,
  };
}

export function stagePsdExport(
  input: PsdExportInput,
  limits: PsdLimits = DEFAULT_PSD_LIMITS,
): Uint8Array {
  if (
    input.width <= 0 ||
    input.height <= 0 ||
    input.width > limits.maxWidth ||
    input.height > limits.maxHeight
  ) {
    throw new PsdHostileFileError("PSD dimensions exceed limits");
  }
  if (input.layers.length > limits.maxLayers)
    throw new PsdHostileFileError("PSD layer count exceeds limits");
  const bytes = new Uint8Array(26);
  const view = new DataView(bytes.buffer);
  bytes.set([0x38, 0x42, 0x50, 0x53]);
  view.setUint16(4, 1, false);
  view.setUint16(12, 4, false);
  view.setUint32(14, input.height, false);
  view.setUint32(18, input.width, false);
  view.setUint16(22, 8, false);
  view.setUint16(24, 3, false);
  return bytes;
}

export function layerMetadata(
  id: string,
  name: string,
  options: Pick<PsdLayerMetadata, "visible" | "opacity" | "editable"> = {
    visible: true,
    opacity: 1,
    editable: true,
  },
): PsdLayerMetadata {
  return { id, name, ...options, warnings: [] };
}
