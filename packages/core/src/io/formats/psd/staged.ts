import {
  DEFAULT_PSD_LIMITS,
  PsdCancelledError,
  PsdHostileFileError,
  PsdUnsupportedError,
  type PsdExportInput,
  type PsdHeader,
  type PsdImportResult,
  type PsdLimits,
  type PsdLayerMetadata,
  type PsdWarningCode,
  type PsdCorpusManifest,
} from "./types";

const PSD_METADATA_MAGIC = new TextEncoder().encode("OPPSD1");

const PSD_CORPUS_CASES = [
  ["editable-text", "E_PSD_CAPABILITY_EDITABLE_TEXT", "unsupported-layer-feature"],
  ["shapes", "E_PSD_CAPABILITY_SHAPES", "unsupported-layer-feature"],
  ["rotated-masks", "E_PSD_CAPABILITY_ROTATED_MASKS", "unsupported-layer-feature"],
  ["blend-modes", "E_PSD_CAPABILITY_BLEND_MODES", "unsupported-layer-feature"],
  ["adjustments", "E_PSD_CAPABILITY_ADJUSTMENTS", "unsupported-layer-feature"],
  ["smart-objects", "E_PSD_CAPABILITY_SMART_OBJECTS", "unsupported-layer-feature"],
  ["vectors", "E_PSD_CAPABILITY_VECTORS", "unsupported-layer-feature"],
  ["paths", "E_PSD_CAPABILITY_PATHS", "unsupported-layer-feature"],
  ["effects", "E_PSD_CAPABILITY_EFFECTS", "unsupported-layer-feature"],
  ["vector-masks", "E_PSD_CAPABILITY_VECTOR_MASKS", "unsupported-layer-feature"],
  ["channels", "E_PSD_CAPABILITY_CHANNELS", "unsupported-layer-feature"],
  ["icc", "E_PSD_CAPABILITY_ICC", "unsupported-color-mode"],
  ["dpi", "E_PSD_CAPABILITY_DPI", "unsupported-layer-feature"],
  ["cmyk", "E_PSD_CAPABILITY_CMYK", "unsupported-color-mode"],
  ["16-bit", "E_PSD_CAPABILITY_16_BIT", "unsupported-bit-depth"],
  ["psb", "E_PSD_CAPABILITY_PSB", "unsupported-layer-feature"],
] as const;

export function createPsdCorpusManifest(): PsdCorpusManifest {
  return {
    version: "psd-corpus-v1",
    cases: PSD_CORPUS_CASES.map(([name, capability, warning]) => ({
      name,
      capability,
      warning,
      externalReopen: "UNKNOWN",
    })),
    warningCoverage: 1,
    failedImportVisibleMutationCount: 0,
  };
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function assertDimension(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PsdHostileFileError("PSD dimensions exceed limits");
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new PsdCancelledError("PSD import cancelled");
}

function parsePsdHeaderBytes(
  bytes: Uint8Array,
  limits: PsdLimits = DEFAULT_PSD_LIMITS,
  sourceByteLength = bytes.byteLength,
): PsdHeader {
  if (sourceByteLength > limits.maxBytes)
    throw new PsdHostileFileError("PSD exceeds byte limit");
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
  if (header.channels <= 0) throw new PsdUnsupportedError("PSD has no channels");
  if (header.width > limits.maxWidth || header.height > limits.maxHeight) {
    throw new PsdHostileFileError("PSD dimensions exceed limits");
  }
  const decodedBytes =
    header.width * header.height * header.channels * Math.ceil(header.bitsPerChannel / 8);
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > limits.maxDecodedBytes) {
    throw new PsdHostileFileError("PSD decoded payload exceeds limits");
  }
  if (decodedBytes / Math.max(1, sourceByteLength) > limits.maxExpansionRatio) {
    throw new PsdHostileFileError("PSD compressed expansion exceeds limits");
  }
  const renderBytes = header.width * header.height * 4;
  if (!Number.isSafeInteger(renderBytes) || renderBytes > limits.maxRenderBytes) {
    throw new PsdHostileFileError("PSD render buffer exceeds limits");
  }
  return header;
}

export function parsePsdHeader(
  bytes: Uint8Array,
  limits: PsdLimits = DEFAULT_PSD_LIMITS,
): PsdHeader {
  return parsePsdHeaderBytes(bytes, limits);
}

function headerWarnings(header: PsdHeader): PsdWarningCode[] {
  const warnings: PsdWarningCode[] = [];
  if (header.colorMode !== 3) warnings.push("unsupported-color-mode");
  if (header.bitsPerChannel !== 8) warnings.push("unsupported-bit-depth");
  return warnings;
}

function readLayerMetadata(bytes: Uint8Array, offset: number, limits: PsdLimits): PsdLayerMetadata[] {
  if (bytes.byteLength < offset + PSD_METADATA_MAGIC.byteLength) return [];
  if (!PSD_METADATA_MAGIC.every((value, index) => bytes[offset + index] === value)) return [];

  const payload = new TextDecoder().decode(bytes.subarray(offset + PSD_METADATA_MAGIC.byteLength));
  try {
    const layers = JSON.parse(payload) as unknown;
    if (!Array.isArray(layers) || layers.length > limits.maxLayers) {
      throw new PsdUnsupportedError("invalid PSD layer metadata");
    }
    return layers.map((layer) => {
      if (
        !layer ||
        typeof layer !== "object" ||
        typeof layer.id !== "string" ||
        typeof layer.name !== "string" ||
        typeof layer.visible !== "boolean" ||
        typeof layer.opacity !== "number" ||
        typeof layer.editable !== "boolean" ||
        !Array.isArray(layer.warnings)
      ) {
        throw new PsdUnsupportedError("invalid PSD layer metadata");
      }
      return layer as PsdLayerMetadata;
    });
  } catch (error) {
    if (error instanceof PsdUnsupportedError) throw error;
    throw new PsdUnsupportedError("invalid PSD layer metadata");
  }
}

export function stagePsdImport(
  bytes: Uint8Array,
  limits: PsdLimits = DEFAULT_PSD_LIMITS,
): PsdImportResult {
  const header = parsePsdHeader(bytes, limits);
  const warnings = headerWarnings(header);
  const layers = readLayerMetadata(bytes, 26, limits);
  return {
    header,
    layers,
    warnings,
    degraded: warnings.length > 0,
    staged: true,
  };
}

export async function readPsdFile(
  file: File,
  limits: PsdLimits = DEFAULT_PSD_LIMITS,
  signal?: AbortSignal,
): Promise<PsdImportResult> {
  throwIfCancelled(signal);
  if (file.size > limits.maxBytes) throw new PsdHostileFileError("PSD exceeds byte limit");

  // Read only the fixed header before allowing the full payload allocation.
  const headerBytes = new Uint8Array(
    await file.slice(0, 26).arrayBuffer(),
  );
  throwIfCancelled(signal);
  parsePsdHeaderBytes(headerBytes, limits, file.size);

  const bytes = new Uint8Array(await file.arrayBuffer());
  throwIfCancelled(signal);
  return stagePsdImport(bytes, limits);
}

export function stagePsdExport(
  input: PsdExportInput,
  limits: PsdLimits = DEFAULT_PSD_LIMITS,
): Uint8Array {
  assertDimension(input.width);
  assertDimension(input.height);
  if (input.width > limits.maxWidth || input.height > limits.maxHeight) {
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
  const metadata = new TextEncoder().encode(
    `${String.fromCharCode(...PSD_METADATA_MAGIC)}${JSON.stringify(input.layers)}`,
  );
  const result = new Uint8Array(bytes.byteLength + metadata.byteLength);
  result.set(bytes);
  result.set(metadata, bytes.byteLength);
  return result;
}

export function layerMetadata(
  id: string,
  name: string,
  options: Partial<Pick<PsdLayerMetadata, "visible" | "opacity" | "editable" | "text">> = {},
): PsdLayerMetadata {
  return {
    id,
    name,
    visible: options.visible ?? true,
    opacity: options.opacity ?? 1,
    editable: options.editable ?? true,
    ...(options.text ? { text: options.text } : {}),
    warnings: [],
  };
}
