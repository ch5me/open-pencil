import {
  DEFAULT_PSD_LIMITS,
  PsdCancelledError,
  PsdHostileFileError,
  PsdUnsupportedError,
  type PsdExportInput,
  type PsdCapabilityCode,
  type PsdCorpusSource,
  type PsdDocumentMetadata,
  type PsdColorMode,
  type PsdHeader,
  type PsdImportResult,
  type PsdLimits,
  type PsdLayerMetadata,
  type PsdWarningCode,
  type PsdCorpusManifest,
  type PsdExternalSource,
  type PsdIccProfile
} from './types'

const PSD_METADATA_MAGIC = new TextEncoder().encode('OPPSD1')

const PSD_EXTERNAL_APPLICATIONS: readonly PsdExternalSource['application'][] = [
  'photoshop',
  'affinity',
  'krita',
  'photopea'
]

type PsdWarningCapabilityCode = Exclude<
  PsdCapabilityCode,
  'E_PSD_CAPABILITY_CMYK' | 'E_PSD_CAPABILITY_16_BIT' | 'E_PSD_CAPABILITY_PSB'
>

export const PSD_CAPABILITY_WARNING_CONTRACT = {
  E_PSD_CAPABILITY_EDITABLE_TEXT: 'unsupported-layer-feature',
  E_PSD_CAPABILITY_SHAPES: 'unsupported-layer-feature',
  E_PSD_CAPABILITY_ROTATED_MASKS: 'unsupported-layer-feature',
  E_PSD_CAPABILITY_BLEND_MODES: 'unsupported-blend-mode',
  E_PSD_CAPABILITY_ADJUSTMENTS: 'unsupported-layer-feature',
  E_PSD_CAPABILITY_SMART_OBJECTS: 'unsupported-layer-feature',
  E_PSD_CAPABILITY_VECTORS: 'unsupported-layer-feature',
  E_PSD_CAPABILITY_PATHS: 'unsupported-layer-feature',
  E_PSD_CAPABILITY_EFFECTS: 'unsupported-layer-feature',
  E_PSD_CAPABILITY_VECTOR_MASKS: 'unsupported-layer-feature',
  E_PSD_CAPABILITY_CHANNELS: 'unsupported-layer-feature',
  E_PSD_CAPABILITY_ICC: 'unsupported-color-mode',
  E_PSD_CAPABILITY_DPI: 'unsupported-layer-feature'
} as const satisfies Readonly<Record<PsdWarningCapabilityCode, PsdWarningCode>>

function capabilityWarning(capability: PsdCapabilityCode): PsdWarningCode | undefined {
  if (
    capability === 'E_PSD_CAPABILITY_CMYK' ||
    capability === 'E_PSD_CAPABILITY_16_BIT' ||
    capability === 'E_PSD_CAPABILITY_PSB'
  ) {
    return undefined
  }
  return PSD_CAPABILITY_WARNING_CONTRACT[capability]
}

export const PSD_EXTERNAL_SOURCE_CONTRACT: readonly PsdExternalSource[] =
  PSD_EXTERNAL_APPLICATIONS.map((application) => ({
    application,
    build: 'UNKNOWN',
    fixture: null,
    sha256: null,
    externalReopen: 'UNKNOWN',
    expected: {
      hierarchy: 'UNKNOWN',
      appearance: 'UNKNOWN',
      editability: 'UNKNOWN'
    }
  }))

function assertSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new PsdUnsupportedError(`${label} must be a lowercase SHA-256 digest`)
  }
}

function assertExternalSource(source: PsdExternalSource, index: number): void {
  const label = `PSD external source ${index}`
  if (source.externalReopen === 'UNKNOWN') {
    if (
      source.expected.hierarchy !== 'UNKNOWN' ||
      source.expected.appearance !== 'UNKNOWN' ||
      source.expected.editability !== 'UNKNOWN'
    ) {
      throw new PsdUnsupportedError(`${label} has inferred external reopen expectations`)
    }
    return
  }
  if (source.build === 'UNKNOWN' || source.fixture === null || source.sha256 === null) {
    throw new PsdUnsupportedError(`${label} lacks external reopen provenance`)
  }
  assertSha256(source.sha256, `${label}.sha256`)
  if (
    source.expected.hierarchy === 'UNKNOWN' ||
    source.expected.appearance === 'UNKNOWN' ||
    source.expected.editability === 'UNKNOWN'
  ) {
    throw new PsdUnsupportedError(`${label} lacks declared hierarchy, appearance, and editability`)
  }
}

function assertCorpusSource(source: PsdCorpusSource): void {
  if (
    source.kind !== 'external' ||
    source.repository.length === 0 ||
    !/^[0-9a-f]{40}$/u.test(source.ref) ||
    source.license.length === 0
  ) {
    throw new PsdUnsupportedError('PSD external corpus provenance is invalid')
  }
}

export function createPsdCorpusManifest(
  cases: PsdCorpusManifest['cases'],
  source: PsdCorpusManifest['source'],
  externalSources: PsdCorpusManifest['externalSources'] = PSD_EXTERNAL_SOURCE_CONTRACT
): PsdCorpusManifest {
  if (cases.length === 0) {
    throw new PsdUnsupportedError('PSD external corpus manifest is empty')
  }
  assertCorpusSource(source)
  if (externalSources.length !== PSD_EXTERNAL_APPLICATIONS.length) {
    throw new PsdUnsupportedError('PSD external source coverage is incomplete')
  }
  if (
    externalSources.some(
      (source, index) =>
        source.application !== PSD_EXTERNAL_APPLICATIONS[index] ||
        !source.build ||
        source.fixture === '' ||
        (source.externalReopen === 'UNKNOWN' &&
          source.sha256 !== null &&
          !/^[0-9a-f]{64}$/u.test(source.sha256))
    )
  ) {
    throw new PsdUnsupportedError('PSD external source contract is invalid')
  }
  externalSources.forEach(assertExternalSource)
  cases.forEach((entry, index) => {
    if (entry.warning.length === 0) {
      throw new PsdUnsupportedError('PSD external corpus warning coverage is incomplete')
    }
    if (entry.warning !== capabilityWarning(entry.capability)) {
      throw new PsdUnsupportedError('PSD external corpus warning does not match capability')
    }
    assertSha256(entry.sha256, `PSD corpus case ${index}.sha256`)
    if (entry.source !== 'external') {
      throw new PsdUnsupportedError('PSD corpus case provenance is invalid')
    }
    assertSha256(
      entry.selfGeneratedRoundTripSha256,
      `PSD corpus case ${index}.selfGeneratedRoundTripSha256`
    )
    if (entry.byteRoundTrip === 'PASS') {
      if (entry.byteRoundTripSha256 === null) {
        throw new PsdUnsupportedError('PSD corpus byte round-trip lacks an exact hash')
      }
      assertSha256(entry.byteRoundTripSha256, `PSD corpus case ${index}.byteRoundTripSha256`)
      if (entry.byteRoundTripSha256 !== entry.sha256) {
        throw new PsdUnsupportedError('PSD corpus byte round-trip hash does not match source bytes')
      }
    } else if (entry.byteRoundTripSha256 !== null) {
      throw new PsdUnsupportedError(
        'PSD corpus byte round-trip hash requires PASS exact-byte status'
      )
    }
    if (
      entry.externalReopen === 'UNKNOWN' &&
      (entry.expected.hierarchy !== 'UNKNOWN' ||
        entry.expected.appearance !== 'UNKNOWN' ||
        entry.expected.editability !== 'UNKNOWN')
    ) {
      throw new PsdUnsupportedError('PSD corpus case has inferred external reopen expectations')
    }
  })
  return {
    version: 'psd-corpus-v1',
    source,
    externalSources,
    cases,
    warningContractCoverage: 1,
    externalWarningCoverage: 'UNKNOWN',
    failedImportVisibleMutationCount: 0
  }
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, false)
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false)
}

function isPsdColorMode(value: number): value is PsdColorMode {
  return [0, 1, 2, 3, 4, 7, 8, 9].includes(value)
}

function assertDimension(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PsdHostileFileError('PSD dimensions exceed limits')
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new PsdCancelledError('PSD import cancelled')
}

function parsePsdHeaderBytes(
  bytes: Uint8Array,
  limits: PsdLimits = DEFAULT_PSD_LIMITS,
  sourceByteLength = bytes.byteLength
): PsdHeader {
  if (sourceByteLength > limits.maxBytes) throw new PsdHostileFileError('PSD exceeds byte limit')
  if (bytes.byteLength < 26) throw new PsdUnsupportedError('PSD header is truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !==
    '8BPS'
  ) {
    throw new PsdUnsupportedError('invalid PSD signature')
  }
  const version = readUint16(view, 4)
  if (version !== 1 && version !== 2)
    throw new PsdUnsupportedError(`unsupported PSD version: ${version}`)
  const colorMode = readUint16(view, 24)
  if (!isPsdColorMode(colorMode)) {
    throw new PsdUnsupportedError(`unsupported PSD color mode: ${colorMode}`)
  }
  const header: PsdHeader = {
    version,
    channels: readUint16(view, 12),
    height: readUint32(view, 14),
    width: readUint32(view, 18),
    bitsPerChannel: readUint16(view, 22),
    colorMode
  }
  if (header.channels <= 0) throw new PsdUnsupportedError('PSD has no channels')
  if (header.width > limits.maxWidth || header.height > limits.maxHeight) {
    throw new PsdHostileFileError('PSD dimensions exceed limits')
  }
  const decodedBytes =
    header.width * header.height * header.channels * Math.ceil(header.bitsPerChannel / 8)
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > limits.maxDecodedBytes) {
    throw new PsdHostileFileError('PSD decoded payload exceeds limits')
  }
  if (decodedBytes / Math.max(1, sourceByteLength) > limits.maxExpansionRatio) {
    throw new PsdHostileFileError('PSD compressed expansion exceeds limits')
  }
  const renderBytes = header.width * header.height * 4
  if (!Number.isSafeInteger(renderBytes) || renderBytes > limits.maxRenderBytes) {
    throw new PsdHostileFileError('PSD render buffer exceeds limits')
  }
  return header
}

export function parsePsdHeader(
  bytes: Uint8Array,
  limits: PsdLimits = DEFAULT_PSD_LIMITS
): PsdHeader {
  return parsePsdHeaderBytes(bytes, limits)
}

function headerWarnings(header: PsdHeader): PsdWarningCode[] {
  const warnings: PsdWarningCode[] = []
  // RGB and CMYK are both first-class producer formats; other PSD modes stay
  // visible as typed degradation rather than being silently coerced.
  if (header.colorMode !== 3 && header.colorMode !== 4) {
    warnings.push('unsupported-color-mode')
  }
  if (header.bitsPerChannel !== 8 && header.bitsPerChannel !== 16) {
    warnings.push('unsupported-bit-depth')
  }
  return warnings
}

const PSD_SUPPORTED_BLEND_MODES = new Set([
  'NORMAL',
  'PASS_THROUGH',
  'MULTIPLY',
  'SCREEN',
  'OVERLAY'
])

function blendModeWarning(layers: readonly PsdLayerMetadata[]): PsdWarningCode[] {
  return layers.some(
    (layer) => layer.blendMode !== undefined && !PSD_SUPPORTED_BLEND_MODES.has(layer.blendMode)
  )
    ? ['unsupported-blend-mode']
    : []
}

const PSD_SUPPORTED_ADJUSTMENT_TYPES = new Set([
  'brightness',
  'contrast',
  'saturation',
  'levels',
  'curves',
  'exposure',
  'vibrance',
  'hsl',
  'color-balance',
  'black-white',
  'threshold',
  'posterize',
  'gradient-map',
  'selective-color'
])

function adjustmentWarning(layers: readonly PsdLayerMetadata[]): PsdWarningCode[] {
  return layers.some(
    (layer) =>
      layer.adjustmentType !== undefined &&
      !PSD_SUPPORTED_ADJUSTMENT_TYPES.has(layer.adjustmentType)
  )
    ? ['unsupported-layer-feature']
    : []
}

function advancedLayerFeatureWarning(layers: readonly PsdLayerMetadata[]): PsdWarningCode[] {
  return layers.some(
    (layer) =>
      layer.smartObjectId !== undefined ||
      layer.smartObjectKind !== undefined ||
      layer.linkedAssetId !== undefined ||
      layer.linkedAssetRevisionId !== undefined ||
      layer.embeddedDocumentId !== undefined ||
      layer.embeddedDocumentVersion !== undefined ||
      layer.vector !== undefined ||
      layer.paths !== undefined ||
      layer.effects !== undefined ||
      layer.vectorMask !== undefined
  )
    ? ['unsupported-layer-feature']
    : []
}

function readLayerMetadata(
  bytes: Uint8Array,
  offset: number,
  limits: PsdLimits
): PsdLayerMetadata[] {
  if (bytes.byteLength < offset + PSD_METADATA_MAGIC.byteLength) return []
  if (!PSD_METADATA_MAGIC.every((value, index) => bytes[offset + index] === value)) return []

  const payload = new TextDecoder().decode(bytes.subarray(offset + PSD_METADATA_MAGIC.byteLength))
  try {
    const parsed = JSON.parse(payload) as unknown
    let layers: unknown = null
    if (Array.isArray(parsed)) {
      layers = parsed
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.layers)) {
      layers = parsed.layers
    }
    if (!layers) throw new PsdUnsupportedError('invalid PSD layer metadata')
    if (!Array.isArray(layers) || layers.length > limits.maxLayers) {
      throw new PsdUnsupportedError('invalid PSD layer metadata')
    }
    return layers.map((layer) => {
      if (
        !layer ||
        typeof layer !== 'object' ||
        typeof layer.id !== 'string' ||
        typeof layer.name !== 'string' ||
        typeof layer.visible !== 'boolean' ||
        typeof layer.opacity !== 'number' ||
        typeof layer.editable !== 'boolean' ||
        !Array.isArray(layer.warnings)
      ) {
        throw new PsdUnsupportedError('invalid PSD layer metadata')
      }
      if (layer.adjustmentType !== undefined && typeof layer.adjustmentType !== 'string') {
        throw new PsdUnsupportedError('invalid PSD adjustment metadata')
      }
      if (
        layer.adjustments !== undefined &&
        (!layer.adjustments ||
          Array.isArray(layer.adjustments) ||
          typeof layer.adjustments !== 'object' ||
          Object.values(layer.adjustments).some(
            (value) => typeof value !== 'number' || !Number.isFinite(value)
          ))
      ) {
        throw new PsdUnsupportedError('invalid PSD adjustment metadata')
      }
      return layer as PsdLayerMetadata
    })
  } catch (error) {
    if (error instanceof PsdUnsupportedError) throw error
    throw new PsdUnsupportedError('invalid PSD layer metadata')
  }
}

function isPSDDocumentMetadata(value: unknown): value is PsdDocumentMetadata {
  return Boolean(value && typeof value === 'object' && Array.isArray(Reflect.get(value, 'layers')))
}

// Metadata validation remains explicit so malformed staged documents fail with precise errors.
// oxlint-disable-next-line complexity
function readDocumentMetadata(
  bytes: Uint8Array,
  offset: number,
  limits: PsdLimits
): PsdDocumentMetadata | undefined {
  if (bytes.byteLength < offset + PSD_METADATA_MAGIC.byteLength) return undefined
  if (!PSD_METADATA_MAGIC.every((value, index) => bytes[offset + index] === value)) return undefined
  const payload = new TextDecoder().decode(bytes.subarray(offset + PSD_METADATA_MAGIC.byteLength))
  try {
    const parsed = JSON.parse(payload) as unknown
    if (Array.isArray(parsed)) {
      return { layers: readLayerMetadata(bytes, offset, limits) }
    }
    if (!isPSDDocumentMetadata(parsed)) {
      throw new PsdUnsupportedError('invalid PSD layer metadata')
    }
    const metadata = parsed
    if (
      metadata.dpi !== undefined &&
      (!Array.isArray(metadata.dpi) ||
        metadata.dpi.length !== 2 ||
        metadata.dpi.some(
          (value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0
        ))
    ) {
      throw new PsdUnsupportedError('invalid PSD DPI metadata')
    }
    if (
      metadata.channels !== undefined &&
      (!Array.isArray(metadata.channels) ||
        metadata.channels.some(
          (channel) =>
            !channel ||
            typeof channel !== 'object' ||
            !Number.isSafeInteger(channel.id) ||
            typeof channel.name !== 'string' ||
            !['color', 'alpha', 'spot'].includes(channel.kind)
        ))
    ) {
      throw new PsdUnsupportedError('invalid PSD channel metadata')
    }
    if (
      metadata.spotColors !== undefined &&
      (!Array.isArray(metadata.spotColors) ||
        metadata.spotColors.some(
          (spot) =>
            !spot ||
            typeof spot !== 'object' ||
            typeof spot.name !== 'string' ||
            !Array.isArray(spot.color) ||
            spot.color.length !== 3 ||
            spot.color.some((value) => typeof value !== 'number' || value < 0 || value > 1)
        ))
    ) {
      throw new PsdUnsupportedError('invalid PSD spot color metadata')
    }
    if (
      metadata.metadata !== undefined &&
      (!metadata.metadata ||
        typeof metadata.metadata !== 'object' ||
        Array.isArray(metadata.metadata))
    ) {
      throw new PsdUnsupportedError('invalid PSD document metadata')
    }
    return metadata
  } catch (error) {
    if (error instanceof PsdUnsupportedError) throw error
    throw new PsdUnsupportedError('invalid PSD layer metadata')
  }
}

function decodeIccProfile(profile: PsdDocumentMetadata['iccProfile']): PsdIccProfile | undefined {
  if (!profile) return undefined
  if (typeof profile.name !== 'string' || !Array.isArray(profile.data)) {
    throw new PsdUnsupportedError('invalid PSD ICC profile metadata')
  }
  if (profile.data.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new PsdUnsupportedError('invalid PSD ICC profile metadata')
  }
  return { name: profile.name, data: Uint8Array.from(profile.data) }
}

export function stagePsdImport(
  bytes: Uint8Array,
  limits: PsdLimits = DEFAULT_PSD_LIMITS
): PsdImportResult {
  const header = parsePsdHeader(bytes, limits)
  const warnings = headerWarnings(header)
  const documentMetadata = readDocumentMetadata(bytes, 26, limits)
  const layers = documentMetadata?.layers ?? []
  const iccProfile = decodeIccProfile(documentMetadata?.iccProfile)
  const enrichedHeader: PsdHeader = {
    ...header,
    ...(documentMetadata?.dpi ? { dpi: documentMetadata.dpi } : {}),
    ...(iccProfile ? { iccProfile } : {}),
    ...(documentMetadata?.channels ? { channelsMetadata: documentMetadata.channels } : {}),
    ...(documentMetadata?.spotColors ? { spotColors: documentMetadata.spotColors } : {}),
    ...(documentMetadata?.metadata ? { metadata: documentMetadata.metadata } : {})
  }
  warnings.push(...blendModeWarning(layers))
  warnings.push(...adjustmentWarning(layers))
  warnings.push(...advancedLayerFeatureWarning(layers))
  return {
    header: enrichedHeader,
    layers,
    warnings,
    degraded: warnings.length > 0,
    staged: true
  }
}

export async function readPsdFile(
  file: File,
  limits: PsdLimits = DEFAULT_PSD_LIMITS,
  signal?: AbortSignal
): Promise<PsdImportResult> {
  throwIfCancelled(signal)
  if (file.size > limits.maxBytes) throw new PsdHostileFileError('PSD exceeds byte limit')

  // Read only the fixed header before allowing the full payload allocation.
  const headerBytes = new Uint8Array(await file.slice(0, 26).arrayBuffer())
  throwIfCancelled(signal)
  parsePsdHeaderBytes(headerBytes, limits, file.size)

  const bytes = new Uint8Array(await file.arrayBuffer())
  throwIfCancelled(signal)
  return stagePsdImport(bytes, limits)
}

// Export validation is intentionally centralized to preserve one deterministic staged format.
// oxlint-disable-next-line complexity
export function stagePsdExport(
  input: PsdExportInput,
  limits: PsdLimits = DEFAULT_PSD_LIMITS
): Uint8Array {
  assertDimension(input.width)
  assertDimension(input.height)
  if (input.width > limits.maxWidth || input.height > limits.maxHeight) {
    throw new PsdHostileFileError('PSD dimensions exceed limits')
  }
  if (input.layers.length > limits.maxLayers)
    throw new PsdHostileFileError('PSD layer count exceeds limits')
  if (input.version !== undefined && input.version !== 1 && input.version !== 2) {
    throw new PsdUnsupportedError(`unsupported PSD version: ${input.version}`)
  }
  if (input.format !== undefined && input.format !== 'psd' && input.format !== 'psb') {
    throw new PsdUnsupportedError(`unsupported PSD format: ${input.format}`)
  }
  if (input.version === 1 && input.format === 'psb') {
    throw new PsdUnsupportedError('PSD version and format disagree')
  }
  if (input.version === 2 && input.format === 'psd') {
    throw new PsdUnsupportedError('PSD version and format disagree')
  }
  const channels = input.channels?.length ?? 4
  if (!Number.isSafeInteger(channels) || channels <= 0 || channels > 56) {
    throw new PsdHostileFileError('PSD channel count exceeds limits')
  }
  const bitsPerChannel = input.bitsPerChannel ?? 8
  if (bitsPerChannel !== 8 && bitsPerChannel !== 16) {
    throw new PsdUnsupportedError(`unsupported PSD bit depth: ${bitsPerChannel}`)
  }
  const bytes = new Uint8Array(26)
  const view = new DataView(bytes.buffer)
  bytes.set([0x38, 0x42, 0x50, 0x53])
  view.setUint16(4, input.format === 'psb' ? 2 : (input.version ?? 1), false)
  view.setUint16(12, channels, false)
  view.setUint32(14, input.height, false)
  view.setUint32(18, input.width, false)
  view.setUint16(22, bitsPerChannel, false)
  view.setUint16(24, input.colorMode ?? 3, false)
  const hasDocumentMetadata =
    input.channels !== undefined ||
    input.dpi !== undefined ||
    input.iccProfile !== undefined ||
    input.spotColors !== undefined ||
    input.metadata !== undefined
  const payload = hasDocumentMetadata
    ? {
        layers: input.layers,
        ...(input.channels ? { channels: structuredClone(input.channels) } : {}),
        ...(input.dpi ? { dpi: structuredClone(input.dpi) } : {}),
        ...(input.iccProfile
          ? {
              iccProfile: {
                name: input.iccProfile.name,
                data: [...input.iccProfile.data]
              }
            }
          : {}),
        ...(input.spotColors ? { spotColors: structuredClone(input.spotColors) } : {}),
        ...(input.metadata ? { metadata: structuredClone(input.metadata) } : {})
      }
    : input.layers
  const metadata = new TextEncoder().encode(
    `${String.fromCharCode(...PSD_METADATA_MAGIC)}${JSON.stringify(payload)}`
  )
  const result = new Uint8Array(bytes.byteLength + metadata.byteLength)
  result.set(bytes)
  result.set(metadata, bytes.byteLength)
  return result
}

/** Stage a PSB document without requiring callers to know the PSD version bit. */
export function stagePsbExport(
  input: Omit<PsdExportInput, 'format' | 'version'>,
  limits: PsdLimits = DEFAULT_PSD_LIMITS
): Uint8Array {
  return stagePsdExport({ ...input, format: 'psb' }, limits)
}

/** Stage-import entrypoint for callers that already selected PSB. */
export function stagePsbImport(
  bytes: Uint8Array,
  limits: PsdLimits = DEFAULT_PSD_LIMITS
): PsdImportResult {
  const result = stagePsdImport(bytes, limits)
  if (result.header.version !== 2) {
    throw new PsdUnsupportedError(`unsupported PSB version: ${result.header.version}`)
  }
  return result
}

export function layerMetadata(
  id: string,
  name: string,
  options: Partial<
    Pick<
      PsdLayerMetadata,
      | 'visible'
      | 'opacity'
      | 'editable'
      | 'text'
      | 'blendMode'
      | 'adjustmentType'
      | 'adjustments'
      | 'smartObjectId'
      | 'smartObjectKind'
      | 'linkedAssetId'
      | 'linkedAssetRevisionId'
      | 'embeddedDocumentId'
      | 'embeddedDocumentVersion'
      | 'vector'
      | 'paths'
      | 'effects'
      | 'vectorMask'
    >
  > = {}
): PsdLayerMetadata {
  return {
    id,
    name,
    visible: options.visible ?? true,
    opacity: options.opacity ?? 1,
    editable: options.editable ?? true,
    ...(options.blendMode ? { blendMode: options.blendMode } : {}),
    ...(options.adjustmentType ? { adjustmentType: options.adjustmentType } : {}),
    ...(options.adjustments ? { adjustments: structuredClone(options.adjustments) } : {}),
    ...(options.text ? { text: structuredClone(options.text) } : {}),
    ...(options.smartObjectId ? { smartObjectId: options.smartObjectId } : {}),
    ...(options.smartObjectKind ? { smartObjectKind: options.smartObjectKind } : {}),
    ...(options.linkedAssetId ? { linkedAssetId: options.linkedAssetId } : {}),
    ...(options.linkedAssetRevisionId
      ? { linkedAssetRevisionId: options.linkedAssetRevisionId }
      : {}),
    ...(options.embeddedDocumentId ? { embeddedDocumentId: options.embeddedDocumentId } : {}),
    ...(options.embeddedDocumentVersion
      ? { embeddedDocumentVersion: options.embeddedDocumentVersion }
      : {}),
    ...(options.vector ? { vector: structuredClone(options.vector) } : {}),
    ...(options.paths ? { paths: structuredClone(options.paths) } : {}),
    ...(options.effects
      ? { effects: options.effects.map((effect) => structuredClone(effect)) }
      : {}),
    ...(options.vectorMask ? { vectorMask: structuredClone(options.vectorMask) } : {}),
    warnings: []
  }
}
