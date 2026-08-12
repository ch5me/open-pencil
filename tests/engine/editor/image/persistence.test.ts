/* oxlint-disable max-lines */

import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { zlibSync } from 'fflate'

import {
  AtomicWorkingDocumentPersistence,
  createAcknowledgedWorkingDocumentIdentity,
  createPersistenceContractReceipt,
  createTerminationInjector,
  detachPNGDataURLs,
  estimateJSONOverhead,
  migrateWorkingDocumentRecord,
  PersistenceConflictError,
  PersistenceContractError,
  PersistenceMigrationError,
  PersistenceQuotaError,
  PersistenceTerminationError,
  recoverWorkingDocument,
  validateDetachedWorkingDocument,
  validateWorkingDocumentRecord,
  verifyDetachedWorkingDocument,
  type DetachedWorkingDocument,
  type PersistenceAdmissionOptions,
  type SaveWorkingDocumentOptions,
  type WorkingDocumentRecord
} from '#core/editor/storage'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
const OTHER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAAF0RVh0eBGYI+kAAAAASUVORK5CYII='
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`
const OTHER_PNG_DATA_URL = `data:image/png;base64,${OTHER_PNG_BASE64}`
const PRIOR_ROOT = 'a'.repeat(64)
const NEXT_ROOT = 'b'.repeat(64)
const THIRD_ROOT = 'c'.repeat(64)

function record(
  contentRootHash: string,
  contentSequence: number,
  payload: Readonly<Record<string, unknown>>
): WorkingDocumentRecord {
  return {
    schema: 'openpencil-working-document-v1',
    schemaVersion: 1,
    documentId: 'doc:one',
    contentSequence,
    contentRootHash,
    payload,
    viewport: { panX: 10, panY: 20, zoom: 1.5 },
    selectionIds: ['layer:one'],
    historySequence: 3,
    commitState: 'committed',
    updatedAt: contentSequence * 10
  }
}

async function detached(
  contentRootHash: string,
  contentSequence: number
): Promise<DetachedWorkingDocument> {
  return detachPNGDataURLs(
    record(contentRootHash, contentSequence, {
      title: contentSequence === 1 ? 'Prior' : 'Next',
      image: contentSequence === 1 ? PNG_DATA_URL : OTHER_PNG_DATA_URL
    })
  )
}

function acknowledgement(workingDocument: WorkingDocumentRecord) {
  return createAcknowledgedWorkingDocumentIdentity(
    workingDocument.documentId,
    workingDocument.contentSequence,
    workingDocument.contentRootHash
  )
}

function pngBytes(base64 = PNG_BASE64): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

function pngDataURL(bytes: Uint8Array): string {
  return `data:image/png;base64,${bytes.toBase64()}`
}

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Uint8Array]' &&
    'BYTES_PER_ELEMENT' in value &&
    value.BYTES_PER_ELEMENT === 1
  )
}

function pngUint32(bytes: Uint8Array, offset: number): number {
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
    crc ^= bytes[index] ?? 0
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array = new Uint8Array()): Uint8Array {
  const chunk = new Uint8Array(12 + data.byteLength)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.byteLength)
  chunk.set(
    Uint8Array.from(type, (character) => character.charCodeAt(0)),
    4
  )
  chunk.set(data, 8)
  view.setUint32(8 + data.byteLength, pngCrc32(chunk, 4, 8 + data.byteLength))
  return chunk
}

function pngChunks(bytes: Uint8Array): Map<string, Uint8Array> {
  const chunks = new Map<string, Uint8Array>()
  let offset = 8
  while (offset < bytes.byteLength) {
    const end = offset + 12 + pngUint32(bytes, offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    chunks.set(type, bytes.slice(offset, end))
    offset = end
  }
  return chunks
}

function pngFromChunks(...chunks: Uint8Array[]): Uint8Array {
  const signature = pngBytes().slice(0, 8)
  const result = new Uint8Array(
    signature.byteLength + chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  )
  result.set(signature)
  let offset = signature.byteLength
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function pngIhdr(
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace = 0
): Uint8Array {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  data.set([bitDepth, colorType, 0, 0, interlace], 8)
  return pngChunk('IHDR', data)
}

function pngImage(
  ihdr: Uint8Array,
  scanlines: Uint8Array,
  ...beforeIdat: Uint8Array[]
): Uint8Array {
  return pngFromChunks(ihdr, ...beforeIdat, pngChunk('IDAT', zlibSync(scanlines)), pngChunk('IEND'))
}

test('persistence-v1 detaches and deduplicates PNG bytes outside JSON', async () => {
  const result = await detachPNGDataURLs(
    record(NEXT_ROOT, 2, {
      image: PNG_DATA_URL,
      nested: [{ duplicate: PNG_DATA_URL }]
    })
  )
  const json = JSON.stringify(result.record)
  expect(json).not.toContain('data:image/png')
  expect(result.assets).toHaveLength(1)
  expect(result.assets[0]?.bytes).toEqual(pngBytes())
  expect(json.match(/detached-binary-asset-v1/gu)).toHaveLength(2)
})

test('persistence-v1 stores exact binary bytes without Base64 expansion', async () => {
  const candidate = await detached(NEXT_ROOT, 2)
  const recordBytes = new TextEncoder().encode(JSON.stringify(candidate.record)).byteLength
  const binaryBytes = candidate.assets.reduce((total, asset) => total + asset.bytes.byteLength, 0)
  const base64Bytes = candidate.assets.reduce(
    (total, asset) => total + Math.ceil(asset.bytes.byteLength / 3) * 4,
    0
  )
  expect(base64Bytes).toBeGreaterThan(binaryBytes)

  const exactBytes = recordBytes + binaryBytes
  const store = new AtomicWorkingDocumentPersistence({ maxBytes: exactBytes })
  await store.save(candidate.record, candidate.assets)
  expect(store.recover(candidate.record.documentId)).toEqual(candidate)

  const tooSmallStore = new AtomicWorkingDocumentPersistence({
    maxBytes: exactBytes - 1
  })
  await expect(tooSmallStore.save(candidate.record, candidate.assets)).rejects.toBeInstanceOf(
    PersistenceQuotaError
  )
  expect(tooSmallStore.recover(candidate.record.documentId)).toBeUndefined()
})

test('persistence-v1 recovers prior ACK or the complete new root over 100 terminations', async () => {
  const prior = await detached(PRIOR_ROOT, 1)
  const next = await detached(NEXT_ROOT, 2)
  let priorRecoveries = 0
  let newRecoveries = 0
  let mixedRoots = 0

  for (let seed = 0; seed < 100; seed++) {
    const store = new AtomicWorkingDocumentPersistence({
      onDurableBoundary: createTerminationInjector(seed, NEXT_ROOT)
    })
    await store.save(prior.record, prior.assets)
    await expect(
      store.save(next.record, next.assets, {
        expectedAcknowledgement: acknowledgement(prior.record)
      })
    ).rejects.toBeInstanceOf(PersistenceTerminationError)

    const recovered = store.recover('doc:one')
    expect(recovered).toBeDefined()
    const recoveredRoot = recovered?.record.contentRootHash
    expect([PRIOR_ROOT, NEXT_ROOT]).toContain(recoveredRoot)
    if (recoveredRoot === PRIOR_ROOT) priorRecoveries++
    if (recoveredRoot === NEXT_ROOT) newRecoveries++

    const expected = recoveredRoot === PRIOR_ROOT ? prior : next
    if (
      JSON.stringify(recovered?.record) !== JSON.stringify(expected.record) ||
      JSON.stringify(recovered?.assets.map(({ reference }) => reference)) !==
        JSON.stringify(expected.assets.map(({ reference }) => reference)) ||
      recovered?.assets.some(
        (asset, index) =>
          asset.bytes.byteLength !== expected.assets[index]?.bytes.byteLength ||
          asset.bytes.some((byte, byteIndex) => byte !== expected.assets[index]?.bytes[byteIndex])
      )
    ) {
      mixedRoots++
    }
  }

  expect(priorRecoveries).toBe(75)
  expect(newRecoveries).toBe(25)
  expect(mixedRoots).toBe(0)
}, 30_000)

test('persistence-v1 first-save termination recovers nothing or one complete new root', async () => {
  const next = await detached(NEXT_ROOT, 1)
  for (let seed = 0; seed < 4; seed++) {
    const store = new AtomicWorkingDocumentPersistence({
      onDurableBoundary: createTerminationInjector(seed, NEXT_ROOT)
    })
    await expect(store.save(next.record, next.assets)).rejects.toBeInstanceOf(
      PersistenceTerminationError
    )
    const recovered = store.recover('doc:one')
    if (seed < 2) {
      expect(recovered).toBeUndefined()
    } else {
      expect(recovered).toEqual(next)
      expect(recovered?.record.commitState).toBe('committed')
    }
  }
})

test('persistence-v1 recovers the latest complete unacknowledged root', async () => {
  const first = await detached(PRIOR_ROOT, 1)
  const latest = await detached(NEXT_ROOT, 2)
  const store = new AtomicWorkingDocumentPersistence({
    onDurableBoundary: (boundary) => {
      if (boundary === 'committed-record') {
        throw new PersistenceTerminationError(boundary, 0)
      }
    }
  })

  await expect(store.save(first.record, first.assets)).rejects.toBeInstanceOf(
    PersistenceTerminationError
  )
  await expect(store.save(latest.record, latest.assets)).rejects.toBeInstanceOf(
    PersistenceTerminationError
  )
  expect(store.recover('doc:one')).toEqual(latest)
})

test('persistence-v1 preserves ACK across same-content-root generation termination', async () => {
  const prior = await detached(PRIOR_ROOT, 1)
  const next = await detached(PRIOR_ROOT, 2)
  for (let seed = 0; seed < 4; seed++) {
    let boundaryCount = 0
    const store = new AtomicWorkingDocumentPersistence({
      onDurableBoundary: (boundary) => {
        if (boundaryCount++ === 4 + seed) throw new PersistenceTerminationError(boundary, seed)
      }
    })
    await store.save(prior.record, prior.assets)
    await expect(
      store.save(next.record, next.assets, {
        expectedAcknowledgement: acknowledgement(prior.record)
      })
    ).rejects.toBeInstanceOf(PersistenceTerminationError)
    expect(store.recover('doc:one')).toEqual(seed < 3 ? prior : next)
  }
})

test('persistence-v1 isolates equal content roots belonging to different documents', async () => {
  const first = await detached(PRIOR_ROOT, 1)
  const second = {
    record: { ...first.record, documentId: 'doc:two' },
    assets: first.assets
  }
  const store = new AtomicWorkingDocumentPersistence()
  await store.save(first.record, first.assets)
  await store.save(second.record, second.assets)
  expect(store.recover('doc:one')?.record.documentId).toBe('doc:one')
  expect(store.recover('doc:two')?.record.documentId).toBe('doc:two')
})

test('persistence-v1 quota and migration failures preserve the acknowledged root', async () => {
  const prior = await detached(PRIOR_ROOT, 1)
  const quotaStore = new AtomicWorkingDocumentPersistence({
    maxBytes:
      new TextEncoder().encode(JSON.stringify(prior.record)).byteLength +
      prior.assets.reduce((total, asset) => total + asset.bytes.byteLength, 0)
  })
  await quotaStore.save(prior.record, prior.assets)
  const oversized = await detachPNGDataURLs(
    record(NEXT_ROOT, 2, { image: PNG_DATA_URL, padding: 'x'.repeat(256) })
  )
  await expect(
    quotaStore.save(oversized.record, oversized.assets, {
      expectedAcknowledgement: acknowledgement(prior.record)
    })
  ).rejects.toBeInstanceOf(PersistenceQuotaError)
  expect(quotaStore.recover('doc:one')?.record.contentRootHash).toBe(PRIOR_ROOT)

  const migrationStore = new AtomicWorkingDocumentPersistence()
  await migrationStore.save(prior.record, prior.assets)
  await expect(
    migrationStore.save(record(NEXT_ROOT, 2, { image: PNG_DATA_URL }), [], {
      expectedAcknowledgement: acknowledgement(prior.record)
    })
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
  expect(migrationStore.recover('doc:one')?.record.contentRootHash).toBe(PRIOR_ROOT)

  const digestMismatch = await detachPNGDataURLs(
    record(NEXT_ROOT, 2, { image: OTHER_PNG_DATA_URL })
  )
  if (digestMismatch.assets[0]) digestMismatch.assets[0].bytes[8] = 1
  await expect(
    migrateWorkingDocumentRecord(digestMismatch.record, digestMismatch.assets)
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
  await expect(
    migrationStore.save(digestMismatch.record, digestMismatch.assets, {
      expectedAcknowledgement: acknowledgement(prior.record)
    })
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
  expect(migrationStore.recover('doc:one')?.record.contentRootHash).toBe(PRIOR_ROOT)
  await expect(
    detachPNGDataURLs(record(NEXT_ROOT, 2, { image: 'data:image/png;base64,bm90LXBuZw==' }))
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
})

test('public editor persistence rejects structurally corrupt PNGs before save or recovery', async () => {
  const valid = pngBytes()
  const chunks = pngChunks(valid)
  const ihdr = chunks.get('IHDR') ?? new Uint8Array()
  const idat = chunks.get('IDAT') ?? new Uint8Array()
  const iend = chunks.get('IEND') ?? new Uint8Array()
  const signatureOnly = valid.slice(0, 8)
  const nonIhdrFirst = pngFromChunks(pngChunk('IDAT', ihdr.slice(8, 21)), idat, iend)
  const invalidIhdrLength = pngFromChunks(pngChunk('IHDR', ihdr.slice(8, 20)), idat, iend)
  const oversizedChunk = valid.slice()
  oversizedChunk.set([0xff, 0xff, 0xff, 0xff], 8)
  const trailingAfterIend = Uint8Array.from([...valid, 0])
  const missingIdat = pngFromChunks(ihdr, pngChunk('tEXt', new Uint8Array(1)), iend)
  const badCrc = valid.slice()
  badCrc[badCrc.byteLength - 1] = (badCrc.at(-1) ?? 0) ^ 1
  const duplicateIhdr = pngFromChunks(ihdr, ihdr, idat, iend)
  const nonconsecutiveIdat = pngFromChunks(ihdr, idat, pngChunk('tEXt'), idat, iend)
  const invalidChunkType = pngFromChunks(ihdr, pngChunk('text'), idat, iend)
  const invalidIhdrFields = valid.slice()
  invalidIhdrFields.set([0, 0, 0, 0], 16)
  new DataView(invalidIhdrFields.buffer).setUint32(29, pngCrc32(invalidIhdrFields, 12, 29))
  const corruptPngs = [
    signatureOnly,
    nonIhdrFirst,
    invalidIhdrLength,
    oversizedChunk,
    trailingAfterIend,
    missingIdat,
    badCrc,
    duplicateIhdr,
    nonconsecutiveIdat,
    invalidChunkType,
    invalidIhdrFields
  ]

  const prior = await detached(PRIOR_ROOT, 1)
  const store = new AtomicWorkingDocumentPersistence()
  await store.save(prior.record, prior.assets)
  for (const bytes of corruptPngs) {
    await expect(
      detachPNGDataURLs(record(NEXT_ROOT, 2, { image: pngDataURL(bytes) }))
    ).rejects.toBeInstanceOf(PersistenceMigrationError)
    const reference = {
      kind: 'detached-binary-asset-v1' as const,
      assetId: `asset:${NEXT_ROOT}` as const,
      revisionId: `sha256:${NEXT_ROOT}` as const,
      mimeType: 'image/png' as const,
      byteLength: bytes.byteLength
    }
    await expect(
      store.save(record(NEXT_ROOT, 2, { image: reference }), [{ reference, bytes }], {
        expectedAcknowledgement: acknowledgement(prior.record)
      })
    ).rejects.toBeInstanceOf(PersistenceMigrationError)
    expect(store.recover(prior.record.documentId)).toEqual(prior)
  }
})

test('public editor persistence validates indexed palettes, transparency order, and IDAT data', async () => {
  const indexedIhdr = pngIhdr(1, 1, 1, 3)
  const palette = pngChunk('PLTE', new Uint8Array(6))
  const transparency = pngChunk('tRNS', new Uint8Array([255]))
  const indexed = pngImage(indexedIhdr, new Uint8Array([0, 0]), palette, transparency)
  await expect(
    detachPNGDataURLs(record(NEXT_ROOT, 2, { image: pngDataURL(indexed) }))
  ).resolves.toMatchObject({ assets: [{ reference: { byteLength: indexed.byteLength } }] })

  const tooManyPaletteEntries = pngImage(
    indexedIhdr,
    new Uint8Array([0, 0]),
    pngChunk('PLTE', new Uint8Array(9))
  )
  const transparencyBeforePalette = pngImage(
    indexedIhdr,
    new Uint8Array([0, 0]),
    transparency,
    palette
  )
  const idat = pngChunk('IDAT', zlibSync(new Uint8Array([0, 0])))
  const transparencyAfterIdat = pngFromChunks(
    indexedIhdr,
    palette,
    idat,
    transparency,
    pngChunk('IEND')
  )
  const paletteAfterIdat = pngFromChunks(indexedIhdr, idat, palette, pngChunk('IEND'))
  const emptyIdat = pngFromChunks(indexedIhdr, palette, pngChunk('IDAT'), pngChunk('IEND'))
  const oversizedTransparency = pngImage(
    indexedIhdr,
    new Uint8Array([0, 0]),
    palette,
    pngChunk('tRNS', new Uint8Array(3))
  )
  const paletteOverflow = pngImage(pngIhdr(5, 1, 2, 3), new Uint8Array([1, 0x55, 0x2b]), palette)

  for (const bytes of [
    tooManyPaletteEntries,
    transparencyBeforePalette,
    transparencyAfterIdat,
    paletteAfterIdat,
    emptyIdat,
    oversizedTransparency,
    paletteOverflow
  ]) {
    await expect(
      detachPNGDataURLs(record(NEXT_ROOT, 2, { image: pngDataURL(bytes) }))
    ).rejects.toBeInstanceOf(PersistenceMigrationError)
  }
})

test('public editor persistence validates bounded zlib framing and decoded scanline size', async () => {
  const rgbaIhdr = pngIhdr(1, 1, 8, 6)
  const validCompressed = zlibSync(new Uint8Array([0, 0, 0, 0, 0]))
  const truecolorTransparencyOverflows = [
    [1, 0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 0, 0, 1, 0]
  ].map((transparency) =>
    pngImage(
      pngIhdr(1, 1, 8, 2),
      new Uint8Array([0, 0, 0, 0]),
      pngChunk('tRNS', new Uint8Array(transparency))
    )
  )
  const badChecksum = validCompressed.slice()
  badChecksum[badChecksum.byteLength - 1] = (badChecksum.at(-1) ?? 0) ^ 1
  const trailingDeflateByte = new Uint8Array(validCompressed.byteLength + 1)
  trailingDeflateByte.set(validCompressed.subarray(0, -4))
  trailingDeflateByte[validCompressed.byteLength - 4] = 0
  trailingDeflateByte.set(validCompressed.subarray(-4), validCompressed.byteLength - 3)
  const corrupt = [
    pngFromChunks(
      rgbaIhdr,
      pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0, 0, 0, 0])),
      pngChunk('IEND')
    ),
    pngImage(rgbaIhdr, new Uint8Array([0, 0, 0, 0])),
    pngFromChunks(rgbaIhdr, pngChunk('IDAT', badChecksum), pngChunk('IEND')),
    pngFromChunks(rgbaIhdr, pngChunk('IDAT', trailingDeflateByte), pngChunk('IEND')),
    pngImage(rgbaIhdr, new Uint8Array([5, 0, 0, 0, 0])),
    pngImage(pngIhdr(1, 1, 1, 0), new Uint8Array([0, 0]), pngChunk('tRNS', new Uint8Array([0, 2]))),
    ...truecolorTransparencyOverflows
  ]

  for (const bytes of corrupt) {
    await expect(
      detachPNGDataURLs(record(NEXT_ROOT, 2, { image: pngDataURL(bytes) }))
    ).rejects.toBeInstanceOf(PersistenceMigrationError)
  }

  const oversizedScanlines = pngImage(pngIhdr(1024, 1024, 8, 6), new Uint8Array(0))
  await expect(
    detachPNGDataURLs(record(NEXT_ROOT, 2, { image: pngDataURL(oversizedScanlines) }), {
      maxDecodedAssetBytes: 1024
    })
  ).rejects.toBeInstanceOf(PersistenceQuotaError)
})

test('public editor persistence accepts 200 generated PNG scanline variants', async () => {
  for (let index = 0; index < 200; index++) {
    const filter = index % 5
    const pixel = index & 0xff
    const bytes = pngImage(pngIhdr(1, 1, 8, 6), new Uint8Array([filter, pixel, pixel, pixel, 255]))
    await expect(
      detachPNGDataURLs(record(NEXT_ROOT, index, { image: pngDataURL(bytes) }))
    ).resolves.toMatchObject({ assets: [{ reference: { byteLength: bytes.byteLength } }] })
  }
})

test('persistence admission rejects encoded, decoded, and aggregate bytes before decode work', async () => {
  const twoAssets = record(NEXT_ROOT, 2, {
    first: PNG_DATA_URL,
    second: OTHER_PNG_DATA_URL
  })
  const decodedBytes = pngBytes().byteLength
  const otherDecodedBytes = pngBytes(OTHER_PNG_BASE64).byteLength
  const quotaCases: readonly PersistenceAdmissionOptions[] = [
    { maxEncodedAssetBytes: PNG_BASE64.length - 1 },
    { maxDecodedAssetBytes: decodedBytes - 1 },
    { maxAggregateEncodedBytes: PNG_BASE64.length + OTHER_PNG_BASE64.length - 1 },
    { maxAggregateDecodedBytes: decodedBytes + otherDecodedBytes - 1 }
  ]
  for (const options of quotaCases) {
    await expect(detachPNGDataURLs(twoAssets, options)).rejects.toBeInstanceOf(
      PersistenceQuotaError
    )
  }

  for (const options of quotaCases.slice(2)) {
    const originalAtob = globalThis.atob
    let atobCalls = 0
    globalThis.atob = (value) => {
      atobCalls++
      return originalAtob(value)
    }
    try {
      await expect(detachPNGDataURLs(twoAssets, options)).rejects.toBeInstanceOf(
        PersistenceQuotaError
      )
      expect(atobCalls).toBe(0)
    } finally {
      globalThis.atob = originalAtob
    }
  }

  const detachedDocument = await detached(NEXT_ROOT, 2)
  const malformedBytes = detachedDocument.assets[0]?.bytes.slice() ?? new Uint8Array()
  malformedBytes.fill(0)
  await expect(
    migrateWorkingDocumentRecord(
      detachedDocument.record,
      [
        {
          reference: {
            ...detachedDocument.assets[0]?.reference,
            byteLength: malformedBytes.byteLength
          },
          bytes: malformedBytes
        }
      ],
      { maxDecodedAssetBytes: malformedBytes.byteLength - 1 }
    )
  ).rejects.toBeInstanceOf(PersistenceQuotaError)
})

test('persistence admission options accept exact validated limits only', async () => {
  const invalidOptions = [
    { unknown: 1 },
    { maxDecodedAssetBytes: -1 },
    { maxEncodedAssetBytes: 1.5 },
    Object.defineProperty({}, 'maxDecodedAssetBytes', {
      enumerable: true,
      get: () => 1
    }),
    new Proxy(
      {},
      {
        ownKeys() {
          throw new TypeError('admission options proxy')
        }
      }
    )
  ]
  for (const options of invalidOptions) {
    await expect(
      Reflect.apply(detachPNGDataURLs, undefined, [record(NEXT_ROOT, 1, {}), options])
    ).rejects.toBeInstanceOf(PersistenceContractError)
    expect(() => Reflect.construct(AtomicWorkingDocumentPersistence, [options])).toThrow(
      PersistenceContractError
    )
  }
})

test('persistence-v1 rejects surplus assets from mixed generations', async () => {
  const prior = await detached(PRIOR_ROOT, 1)
  const next = await detached(NEXT_ROOT, 2)
  const surplus = await detachPNGDataURLs(record(THIRD_ROOT, 3, { image: OTHER_PNG_DATA_URL }))
  const store = new AtomicWorkingDocumentPersistence()
  await store.save(prior.record, prior.assets)
  await expect(
    store.save(next.record, [...next.assets, ...surplus.assets], {
      expectedAcknowledgement: acknowledgement(prior.record)
    })
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
  await expect(
    store.save(
      record(NEXT_ROOT, 2, {
        image: { ...next.assets[0]?.reference, hidden: surplus.assets[0]?.reference }
      }),
      next.assets,
      { expectedAcknowledgement: acknowledgement(prior.record) }
    )
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
  expect(store.recover('doc:one')).toEqual(prior)
})

test('persistence-v1 rejects stale sequences and stale-root CAS without regressing ACK', async () => {
  const prior = await detached(PRIOR_ROOT, 1)
  const next = await detached(NEXT_ROOT, 2)
  const third = await detachPNGDataURLs(
    record(THIRD_ROOT, 3, { title: 'Third', image: OTHER_PNG_DATA_URL })
  )
  const store = new AtomicWorkingDocumentPersistence()
  await store.save(prior.record, prior.assets)
  await store.save(next.record, next.assets, {
    expectedAcknowledgement: acknowledgement(prior.record)
  })

  await expect(
    store.save(prior.record, prior.assets, {
      expectedAcknowledgement: acknowledgement(next.record)
    })
  ).rejects.toBeInstanceOf(PersistenceConflictError)
  await expect(
    store.save(third.record, third.assets, {
      expectedAcknowledgement: acknowledgement(prior.record)
    })
  ).rejects.toBeInstanceOf(PersistenceConflictError)
  await expect(
    store.save(third.record, third.assets, {
      expectedAcknowledgement: { ...acknowledgement(next.record), rootKey: 'wrong' }
    })
  ).rejects.toBeInstanceOf(PersistenceContractError)
  await expect(
    store.save({ ...next.record, contentRootHash: THIRD_ROOT }, next.assets, {
      expectedAcknowledgement: acknowledgement(next.record)
    })
  ).rejects.toBeInstanceOf(PersistenceConflictError)
  expect(store.recover('doc:one')).toEqual(next)
})

test('persistence-v1 rejects same-root ABA against the acknowledged generation', async () => {
  const first = await detached(PRIOR_ROOT, 1)
  const middle = await detached(NEXT_ROOT, 2)
  const latest = await detached(PRIOR_ROOT, 3)
  const candidate = await detached(THIRD_ROOT, 4)
  const boundaries: string[] = []
  const store = new AtomicWorkingDocumentPersistence({
    onDurableBoundary: (boundary) => boundaries.push(boundary)
  })
  await store.save(first.record, first.assets)
  await store.save(middle.record, middle.assets, {
    expectedAcknowledgement: acknowledgement(first.record)
  })
  await store.save(latest.record, latest.assets, {
    expectedAcknowledgement: acknowledgement(middle.record)
  })

  await expect(
    store.save(candidate.record, candidate.assets, {
      expectedAcknowledgement: acknowledgement(first.record)
    })
  ).rejects.toBeInstanceOf(PersistenceConflictError)
  const boundaryCount = boundaries.length
  await expect(store.save(candidate.record, candidate.assets)).rejects.toBeInstanceOf(
    PersistenceConflictError
  )
  await expect(
    store.save(candidate.record, candidate.assets, { expectedAcknowledgement: undefined })
  ).rejects.toBeInstanceOf(PersistenceConflictError)
  expect(boundaries).toHaveLength(boundaryCount)
  expect(store.recover('doc:one')).toEqual(latest)
})

test('persistence-v1 exposes acknowledgement-only save options and requires full ACK', async () => {
  type HasRootOnlyOption = 'expectedContentRootHash' extends keyof SaveWorkingDocumentOptions
    ? true
    : false
  const hasRootOnlyOption: HasRootOnlyOption = false
  expect(hasRootOnlyOption).toBeFalse()

  const prior = await detached(PRIOR_ROOT, 1)
  const next = await detached(NEXT_ROOT, 2)
  const store = new AtomicWorkingDocumentPersistence()
  await store.save(prior.record, prior.assets)
  await expect(store.save(next.record, next.assets)).rejects.toBeInstanceOf(
    PersistenceConflictError
  )
  expect(store.recover('doc:one')).toEqual(prior)
})

test('public editor save accepts exact options only', async () => {
  const prior = await detached(PRIOR_ROOT, 1)
  const next = await detached(NEXT_ROOT, 2)
  const invalidOptions = [
    { expectedContentRootHash: PRIOR_ROOT },
    { unknown: true },
    { expectedAcknowledgement: acknowledgement(prior.record), unknown: true },
    Object.defineProperty({}, 'expectedAcknowledgement', {
      enumerable: true,
      get: () => acknowledgement(prior.record)
    }),
    new Proxy(
      {},
      {
        ownKeys() {
          throw new TypeError('save options proxy')
        }
      }
    )
  ]

  for (const options of invalidOptions) {
    const store = new AtomicWorkingDocumentPersistence()
    await store.save(prior.record, prior.assets)
    await expect(
      Reflect.apply(store.save.bind(store), undefined, [next.record, next.assets, options])
    ).rejects.toBeInstanceOf(PersistenceContractError)
    expect(store.recover(prior.record.documentId)).toEqual(prior)
  }
})

test('persistence-v1 rejects non-JSON payload representations before serialization', async () => {
  const prior = await detached(PRIOR_ROOT, 1)
  const store = new AtomicWorkingDocumentPersistence()
  await store.save(prior.record, prior.assets)
  const sparse: unknown[] = []
  sparse.length = 1
  const accessor: unknown[] = []
  Object.defineProperty(accessor, 0, { enumerable: true, get: () => 'value' })
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const invalidValues: readonly unknown[] = [
    undefined,
    Number.NaN,
    -0,
    1n,
    Symbol('value'),
    () => 'value',
    new Date(0),
    sparse,
    accessor,
    cyclic
  ]

  for (const invalid of invalidValues) {
    await expect(store.save(record(NEXT_ROOT, 2, { invalid }), [])).rejects.toBeInstanceOf(
      PersistenceContractError
    )
    expect(store.recover('doc:one')).toEqual(prior)
  }
})

test('persistence-v1 rejects non-JSON whole-record representations before serialization', async () => {
  const base = record(NEXT_ROOT, 1, {})
  const invalidRecords: WorkingDocumentRecord[] = [
    Object.assign({ ...base }, { extra: 1n }),
    Object.assign({ ...base }, { extra: undefined }),
    Object.assign({ ...base }, { extra: () => 'value' }),
    Object.assign({ ...base }, { extra: Symbol('value') })
  ]

  const sparseSelection = [...base.selectionIds]
  sparseSelection.length = 2
  invalidRecords.push({ ...base, selectionIds: sparseSelection })

  const accessorSelection: string[] = []
  Object.defineProperty(accessorSelection, 0, {
    enumerable: true,
    get: () => 'layer:one'
  })
  accessorSelection.length = 1
  invalidRecords.push({ ...base, selectionIds: accessorSelection })

  const prototypeSelection = [...base.selectionIds]
  Object.setPrototypeOf(prototypeSelection, null)
  invalidRecords.push({ ...base, selectionIds: prototypeSelection })

  for (const invalidRecord of invalidRecords) {
    await expect(
      new AtomicWorkingDocumentPersistence().save(invalidRecord, [])
    ).rejects.toBeInstanceOf(PersistenceContractError)
  }
})

test('public editor recovery rejects hostile record array shapes with typed errors', () => {
  const base = record(PRIOR_ROOT, 1, {})
  const sparse = [base]
  sparse.length = 2
  const extraKey = [base]
  Reflect.set(extraKey, 'extra', base)
  const accessorRecord = { ...base }
  Object.defineProperty(accessorRecord, 'documentId', {
    enumerable: true,
    get: () => {
      throw new TypeError('record getter executed')
    }
  })
  const hostileArrays: readonly unknown[] = [
    null,
    1,
    {},
    sparse,
    extraKey,
    [null],
    [undefined],
    [1],
    [{ ...base, extra: true }],
    [accessorRecord]
  ]

  for (const hostile of hostileArrays) {
    expect(() =>
      Reflect.apply(recoverWorkingDocument, undefined, [
        hostile,
        base.documentId,
        acknowledgement(base)
      ])
    ).toThrow(PersistenceContractError)
  }
})

test('public editor save and migration reject hostile asset array shapes with typed errors', async () => {
  const detachedDocument = await detached(PRIOR_ROOT, 1)
  const asset = detachedDocument.assets[0]
  const sparse = [asset]
  sparse.length = 2
  const extraArrayKey = [asset]
  Reflect.set(extraArrayKey, 'extra', asset)
  const accessorAsset = { ...asset }
  Object.defineProperty(accessorAsset, 'bytes', {
    enumerable: true,
    get: () => {
      throw new TypeError('asset getter executed')
    }
  })
  const hostileArrays: readonly unknown[] = [
    null,
    1,
    {},
    sparse,
    extraArrayKey,
    [null],
    [undefined],
    [1],
    [{ reference: asset.reference }],
    [{ ...asset, extra: true }],
    [accessorAsset]
  ]

  for (const hostile of hostileArrays) {
    const store = new AtomicWorkingDocumentPersistence()
    await expect(
      Reflect.apply(store.save.bind(store), undefined, [detachedDocument.record, hostile])
    ).rejects.toBeInstanceOf(PersistenceContractError)
    await expect(
      Reflect.apply(migrateWorkingDocumentRecord, undefined, [detachedDocument.record, hostile])
    ).rejects.toBeInstanceOf(PersistenceContractError)
  }
  const store = new AtomicWorkingDocumentPersistence()
  await expect(
    Reflect.apply(store.save.bind(store), undefined, [detachedDocument.record, undefined])
  ).rejects.toBeInstanceOf(PersistenceContractError)
  await expect(
    Reflect.apply(migrateWorkingDocumentRecord, undefined, [detachedDocument.record, undefined])
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
})

test('public editor save and migration reject corrupt exact-shape asset fields without TypeError', async () => {
  const detachedDocument = await detached(PRIOR_ROOT, 1)
  const asset = detachedDocument.assets[0]
  const accessorReference = { ...asset.reference }
  Object.defineProperty(accessorReference, 'revisionId', {
    enumerable: true,
    get: () => {
      throw new TypeError('reference getter executed')
    }
  })
  const corruptAssets: readonly unknown[] = [
    [{ reference: null, bytes: asset.bytes }],
    [{ reference: asset.reference, bytes: null }],
    [{ reference: { ...asset.reference, extra: true }, bytes: asset.bytes }],
    [{ reference: accessorReference, bytes: asset.bytes }]
  ]

  for (const corrupt of corruptAssets) {
    const store = new AtomicWorkingDocumentPersistence()
    await expect(
      Reflect.apply(store.save.bind(store), undefined, [detachedDocument.record, corrupt])
    ).rejects.toBeInstanceOf(PersistenceMigrationError)
    await expect(
      Reflect.apply(migrateWorkingDocumentRecord, undefined, [detachedDocument.record, corrupt])
    ).rejects.toBeInstanceOf(PersistenceMigrationError)
  }
})

test('persistence-v1 rejects unknown JSON-safe record keys before PNG detachment', async () => {
  const base = record(NEXT_ROOT, 1, {})
  const embedded = { ...base }
  const benign = { ...base }
  Reflect.set(embedded, 'extra', PNG_DATA_URL)
  Reflect.set(benign, 'extra', { benign: true })
  await expect(detachPNGDataURLs(embedded)).rejects.toBeInstanceOf(PersistenceContractError)
  await expect(detachPNGDataURLs(benign)).rejects.toBeInstanceOf(PersistenceContractError)
})

test('public editor API rejects unknown viewport keys before PNG detachment', async () => {
  const embedded = record(NEXT_ROOT, 1, {})
  const benign = record(NEXT_ROOT, 1, {})
  Reflect.set(embedded.viewport, 'extra', PNG_DATA_URL)
  Reflect.set(benign.viewport, 'extra', true)

  await expect(detachPNGDataURLs(embedded)).rejects.toBeInstanceOf(PersistenceContractError)
  await expect(detachPNGDataURLs(benign)).rejects.toBeInstanceOf(PersistenceContractError)
})

test('persistence-v1 rejects PNG data URLs outside payload arrays', async () => {
  await expect(
    detachPNGDataURLs({ ...record(NEXT_ROOT, 1, {}), selectionIds: [PNG_DATA_URL] })
  ).rejects.toBeInstanceOf(PersistenceContractError)
})

test('persistence-v1 rejects PNG data URLs in nested payload keys', async () => {
  await expect(
    detachPNGDataURLs(record(NEXT_ROOT, 1, { nested: { [PNG_DATA_URL]: true } }))
  ).rejects.toBeInstanceOf(PersistenceContractError)
})

test('persistence-v1 detaches caller and recovery asset buffers', async () => {
  const next = await detachPNGDataURLs(record(NEXT_ROOT, 1, { image: OTHER_PNG_DATA_URL }))
  const store = new AtomicWorkingDocumentPersistence()
  const originalByte = next.assets[0]?.bytes[8]
  const pendingSave = store.save(next.record, next.assets)
  if (next.assets[0]) next.assets[0].bytes[8] = 1
  await pendingSave
  const firstRecovery = store.recover('doc:one')
  expect(firstRecovery?.assets[0]?.bytes[8]).toBe(originalByte)
  if (firstRecovery?.assets[0]) firstRecovery.assets[0].bytes[8] = 1
  expect(store.recover('doc:one')?.assets[0]?.bytes[8]).toBe(originalByte)
})

test('persistence-v1 migration snapshots record and assets before async digest', async () => {
  const source = await detached(PRIOR_ROOT, 1)
  const originalRecord = structuredClone(source.record)
  const migration = migrateWorkingDocumentRecord(source.record, source.assets)

  Reflect.set(source.record, 'documentId', 'doc:mutated')
  Reflect.set(source.record.payload, 'title', 'Mutated')
  if (source.assets[0]) {
    source.assets[0].bytes[0] = 0
    Reflect.set(source.assets[0].reference, 'revisionId', `sha256:${THIRD_ROOT}`)
  }

  await expect(migration).resolves.toEqual(originalRecord)
})

test('public async persistence helpers snapshot complete inputs before digest awaits', async () => {
  const source = record(NEXT_ROOT, 2, {
    first: PNG_DATA_URL,
    second: OTHER_PNG_DATA_URL,
    title: 'Original'
  })
  const original = structuredClone(source)
  const detachment = detachPNGDataURLs(source)

  Reflect.set(source, 'documentId', 'doc:mutated')
  Reflect.set(source, 'contentRootHash', THIRD_ROOT)
  Reflect.set(source.viewport, 'panX', 999)
  Reflect.apply(Array.prototype.splice, source.selectionIds, [0])
  Reflect.set(source.payload, 'title', 'Mutated')

  const detachedSnapshot = await detachment
  expect(detachedSnapshot.record.documentId).toBe(original.documentId)
  expect(detachedSnapshot.record.contentRootHash).toBe(original.contentRootHash)
  expect(detachedSnapshot.record.viewport).toEqual(original.viewport)
  expect(detachedSnapshot.record.selectionIds).toEqual(original.selectionIds)
  expect(detachedSnapshot.record.payload.title).toBe('Original')

  const verification = verifyDetachedWorkingDocument(
    detachedSnapshot.record,
    detachedSnapshot.assets
  )
  Reflect.set(detachedSnapshot.record, 'documentId', 'doc:changed-after-verify')
  if (detachedSnapshot.assets[0]) {
    Reflect.set(detachedSnapshot.assets[0].reference, 'revisionId', `sha256:${THIRD_ROOT}`)
    detachedSnapshot.assets[0].bytes[0] = 0
  }
  if (detachedSnapshot.assets[1]) detachedSnapshot.assets[1].bytes[1] = 0
  await expect(verification).resolves.toBeUndefined()
})

test('public save snapshots acknowledgement options before digest awaits', async () => {
  const prior = await detached(PRIOR_ROOT, 1)
  const next = await detached(NEXT_ROOT, 2)
  const expectedAcknowledgement = acknowledgement(prior.record)
  const options = { expectedAcknowledgement }
  const store = new AtomicWorkingDocumentPersistence()
  await store.save(prior.record, prior.assets)

  const save = store.save(next.record, next.assets, options)
  Reflect.set(expectedAcknowledgement, 'contentRootHash', THIRD_ROOT)
  Reflect.set(options, 'expectedAcknowledgement', acknowledgement(next.record))

  await expect(save).resolves.toBeUndefined()
  expect(store.recover(prior.record.documentId)).toEqual(next)
})

test('public persistence boundaries normalize access traps without double-wrapping', async () => {
  const base = record(PRIOR_ROOT, 1, {})
  const rawTrap = () => {
    throw new TypeError('hostile public getter')
  }
  const hostileRecord = new Proxy(base, { ownKeys: rawTrap })
  const hostilePayload = new Proxy({}, { ownKeys: rawTrap })
  const hostileRecords = new Proxy([base], { ownKeys: rawTrap })
  const hostileAssets = new Proxy([], { ownKeys: rawTrap })
  const hostileReceipt = new Proxy({}, { ownKeys: rawTrap })
  const hostileSaveOptions = Object.defineProperty({}, 'expectedAcknowledgement', {
    enumerable: true,
    get: rawTrap
  })

  const syncCalls = [
    () => validateWorkingDocumentRecord(hostileRecord),
    () => validateDetachedWorkingDocument(base, hostileAssets),
    () => recoverWorkingDocument(hostileRecords, base.documentId, acknowledgement(base)),
    () => estimateJSONOverhead(hostilePayload),
    () => createPersistenceContractReceipt(hostileReceipt)
  ]
  for (const call of syncCalls) {
    try {
      call()
      throw new Error('expected persistence boundary failure')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({ code: expect.stringMatching(/^E_IMAGE_PERSISTENCE_/u) })
    }
  }

  await expect(detachPNGDataURLs(hostileRecord)).rejects.toMatchObject({
    code: 'E_IMAGE_PERSISTENCE_CONTRACT'
  })
  await expect(
    Reflect.apply(verifyDetachedWorkingDocument, undefined, [base, hostileAssets])
  ).rejects.toMatchObject({ code: 'E_IMAGE_PERSISTENCE_MIGRATION' })
  const hostileOptionsStore = new AtomicWorkingDocumentPersistence()
  await expect(hostileOptionsStore.save(base, [], hostileSaveOptions)).rejects.toMatchObject({
    code: 'E_IMAGE_PERSISTENCE_CONTRACT'
  })
  expect(() =>
    Reflect.construct(AtomicWorkingDocumentPersistence, [{ onBoundary: 'not-a-function' }])
  ).toThrow(PersistenceContractError)

  const typed = new PersistenceContractError('preserve identity')
  const typedTrap = new Proxy(
    {},
    {
      ownKeys() {
        throw typed
      }
    }
  )
  try {
    estimateJSONOverhead(typedTrap)
    throw new Error('expected typed persistence failure')
  } catch (error) {
    expect(error).toBe(typed)
  }

  const asyncTyped = new PersistenceConflictError('preserve async identity')
  const asyncTypedRecord = new Proxy(base, {
    ownKeys() {
      throw asyncTyped
    }
  })
  await expect(detachPNGDataURLs(asyncTypedRecord)).rejects.toBe(asyncTyped)

  const saveTyped = new PersistenceQuotaError('preserve save identity')
  const typedSaveOptions = new Proxy(
    {},
    {
      ownKeys() {
        throw saveTyped
      }
    }
  )
  await expect(
    new AtomicWorkingDocumentPersistence().save(base, [], typedSaveOptions)
  ).rejects.toBe(saveTyped)
})

test('public persistence normalization preserves specialized error identity and codes', () => {
  const errors = [
    new PersistenceContractError('contract'),
    new PersistenceQuotaError('quota'),
    new PersistenceMigrationError('migration'),
    new PersistenceConflictError('conflict'),
    new PersistenceTerminationError('asset', 0)
  ]

  for (const typed of errors) {
    expect(typed).toBeInstanceOf(PersistenceContractError)
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw typed
        }
      }
    )
    try {
      Reflect.apply(createPersistenceContractReceipt, undefined, [hostile])
      throw new Error('expected typed persistence failure')
    } catch (error) {
      expect(error).toBe(typed)
      expect(error).toMatchObject({ code: typed.code })
    }
  }
})

test('public persistence receipt accepts exact state overrides only', () => {
  expect(
    createPersistenceContractReceipt({
      atomicSave: 'SUPPORTED',
      crashRecovery: 'UNSUPPORTED'
    })
  ).toMatchObject({
    version: 'persistence-v1',
    atomicSave: 'SUPPORTED',
    crashRecovery: 'UNSUPPORTED'
  })

  const invalidOverrides = [
    { version: 'persistence-v1' },
    { jsonOverheadBytes: 1 },
    { unknown: 'SUPPORTED' },
    { atomicSave: 'YES' },
    Object.defineProperty({}, 'atomicSave', {
      enumerable: true,
      get: () => 'SUPPORTED'
    }),
    { [Symbol('atomicSave')]: 'SUPPORTED' },
    new Proxy(
      {},
      {
        ownKeys() {
          throw new TypeError('receipt proxy')
        }
      }
    )
  ]
  for (const overrides of invalidOverrides) {
    expect(() => Reflect.apply(createPersistenceContractReceipt, undefined, [overrides])).toThrow(
      PersistenceContractError
    )
  }
})

test('persistence-v1 rejects unsupported image data URLs everywhere persisted', async () => {
  const jpegDataURL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
  const svgDataURL = 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E'

  await expect(
    detachPNGDataURLs(record(NEXT_ROOT, 1, { image: jpegDataURL }))
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
  await expect(
    new AtomicWorkingDocumentPersistence().save(record(NEXT_ROOT, 1, { image: svgDataURL }), [])
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
  await expect(
    detachPNGDataURLs({ ...record(NEXT_ROOT, 1, {}), selectionIds: [jpegDataURL] })
  ).rejects.toBeInstanceOf(PersistenceContractError)
})

test('persistence-v1 accepts cross-realm Uint8Array and rejects other views', async () => {
  const source = await detached(PRIOR_ROOT, 1)
  const crossRealmBytes: unknown = runInNewContext('Uint8Array.from(bytes)', {
    bytes: [...pngBytes()]
  })
  if (!isUint8Array(crossRealmBytes)) {
    throw new Error('cross-realm value is not a Uint8Array')
  }
  const bytes = crossRealmBytes
  expect(bytes instanceof Uint8Array).toBeFalse()

  const crossRealmAssets = [{ reference: source.assets[0]?.reference, bytes }]
  await expect(migrateWorkingDocumentRecord(source.record, crossRealmAssets)).resolves.toEqual(
    source.record
  )

  for (const invalidBytes of [
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
  ]) {
    await expect(
      Reflect.apply(migrateWorkingDocumentRecord, undefined, [
        source.record,
        [{ reference: source.assets[0]?.reference, bytes: invalidBytes }]
      ])
    ).rejects.toBeInstanceOf(PersistenceMigrationError)
  }
})

test('public editor API wraps detached asset buffers before persistence mutation', async () => {
  const prior = await detached(PRIOR_ROOT, 1)
  const candidate = await detached(NEXT_ROOT, 2)
  const bytes = candidate.assets[0]?.bytes
  expect(bytes).toBeDefined()
  structuredClone(bytes.buffer, { transfer: [bytes.buffer] })
  const store = new AtomicWorkingDocumentPersistence()
  await store.save(prior.record, prior.assets)

  await expect(
    migrateWorkingDocumentRecord(candidate.record, candidate.assets)
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
  await expect(
    store.save(candidate.record, candidate.assets, {
      expectedAcknowledgement: acknowledgement(prior.record)
    })
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
  expect(store.recover(prior.record.documentId)).toEqual(prior)
})

test('public editor API wraps hostile byte proxies before persistence mutation', async () => {
  const prior = await detached(PRIOR_ROOT, 1)
  const candidate = await detached(NEXT_ROOT, 2)
  const bytes = new Proxy(candidate.assets[0]?.bytes ?? new Uint8Array(), {
    getPrototypeOf() {
      throw new Error('hostile byte proxy')
    }
  })
  const assets = [{ reference: candidate.assets[0]?.reference, bytes }]
  const store = new AtomicWorkingDocumentPersistence()
  await store.save(prior.record, prior.assets)

  await expect(
    Reflect.apply(migrateWorkingDocumentRecord, undefined, [candidate.record, assets])
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
  await expect(
    store.save(candidate.record, assets, {
      expectedAcknowledgement: acknowledgement(prior.record)
    })
  ).rejects.toBeInstanceOf(PersistenceMigrationError)
  expect(store.recover(prior.record.documentId)).toEqual(prior)
})

test('persistence-v1 preserves existing record and receipt APIs', () => {
  const baseRecord = record(PRIOR_ROOT, 1, { title: 'Draft', assets: ['asset:one'] })
  expect(() => validateWorkingDocumentRecord(baseRecord)).not.toThrow()
  const receipt = createPersistenceContractReceipt(
    {
      atomicSave: 'SUPPORTED',
      deduplication: 'SUPPORTED',
      schemaMigration: 'SUPPORTED',
      crashRecovery: 'SUPPORTED'
    },
    estimateJSONOverhead(baseRecord.payload)
  )
  expect(receipt.version).toBe('persistence-v1')
  expect(receipt.jsonOverheadBytes).toBeGreaterThanOrEqual(0)

  const staged = { ...baseRecord, contentSequence: 5, commitState: 'staged' as const }
  const staleCommitted = {
    ...baseRecord,
    contentSequence: 2,
    payload: { title: 'Stale' },
    updatedAt: 10
  }
  const committed = {
    ...baseRecord,
    contentSequence: 2,
    payload: { title: 'Latest' },
    updatedAt: 20
  }
  expect(
    recoverWorkingDocument(
      [staged, baseRecord, staleCommitted, committed],
      'doc:one',
      acknowledgement(committed)
    )?.payload
  ).toEqual({ title: 'Latest' })
  expect(
    recoverWorkingDocument(
      [baseRecord],
      'doc:missing',
      createAcknowledgedWorkingDocumentIdentity(
        'doc:missing',
        baseRecord.contentSequence,
        baseRecord.contentRootHash
      )
    )
  ).toBeUndefined()
  const sourceSelection = ['layer:one']
  const recovered = recoverWorkingDocument(
    [{ ...baseRecord, selectionIds: sourceSelection }],
    'doc:one',
    acknowledgement(baseRecord)
  )
  sourceSelection.splice(0)
  expect(recovered?.selectionIds).toEqual(['layer:one'])
  expect(() =>
    validateWorkingDocumentRecord({ ...baseRecord, viewport: { ...baseRecord.viewport, zoom: 0 } })
  ).toThrow(PersistenceContractError)
})

test('public recovery rejects empty and hostile document identifiers', async () => {
  const prior = await detached(PRIOR_ROOT, 1)
  const store = new AtomicWorkingDocumentPersistence()
  await store.save(prior.record, prior.assets)
  const invalidDocumentIds = [
    '',
    null,
    undefined,
    1,
    {},
    new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new TypeError('documentId proxy')
        }
      }
    )
  ]

  for (const documentId of invalidDocumentIds) {
    expect(() => Reflect.apply(store.recover.bind(store), undefined, [documentId])).toThrow(
      PersistenceContractError
    )
    expect(() =>
      Reflect.apply(recoverWorkingDocument, undefined, [
        [prior.record],
        documentId,
        acknowledgement(prior.record)
      ])
    ).toThrow(PersistenceContractError)
  }
  expect(store.recover(prior.record.documentId)).toEqual(prior)
})

test('public identity helpers require exact document, sequence, hash, and root-key shapes', () => {
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new TypeError('hostile identity input')
      }
    }
  )
  for (const documentId of ['', null, undefined, 1, hostile]) {
    expect(() =>
      Reflect.apply(createAcknowledgedWorkingDocumentIdentity, undefined, [
        documentId,
        1,
        PRIOR_ROOT
      ])
    ).toThrow(PersistenceContractError)
  }
  for (const sequence of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, hostile]) {
    expect(() =>
      Reflect.apply(createAcknowledgedWorkingDocumentIdentity, undefined, [
        'doc:one',
        sequence,
        PRIOR_ROOT
      ])
    ).toThrow(PersistenceContractError)
  }
  for (const contentRootHash of [
    '',
    'A'.repeat(64),
    'a'.repeat(63),
    `${'a'.repeat(63)}g`,
    null,
    hostile
  ]) {
    expect(() =>
      Reflect.apply(createAcknowledgedWorkingDocumentIdentity, undefined, [
        'doc:one',
        1,
        contentRootHash
      ])
    ).toThrow(PersistenceContractError)
  }

  const valid = createAcknowledgedWorkingDocumentIdentity('doc:one', 1, PRIOR_ROOT)
  const symbolExtra = { ...valid }
  Reflect.set(symbolExtra, Symbol('extra'), true)
  const hiddenExtra = Object.defineProperty({ ...valid }, 'extra', { value: true })
  const invalidIdentities = [
    { ...valid, rootKey: '' },
    { ...valid, contentSequence: -1 },
    { ...valid, contentRootHash: 'A'.repeat(64) },
    { contentSequence: 1, contentRootHash: PRIOR_ROOT },
    { ...valid, extra: true },
    symbolExtra,
    hiddenExtra,
    Object.defineProperty({ ...valid }, 'rootKey', {
      enumerable: true,
      get() {
        throw new TypeError('root key getter')
      }
    }),
    hostile
  ]
  for (const identity of invalidIdentities) {
    expect(() =>
      Reflect.apply(recoverWorkingDocument, undefined, [
        [record(PRIOR_ROOT, 1, {})],
        'doc:one',
        identity
      ])
    ).toThrow(PersistenceContractError)
  }
  expect(() =>
    recoverWorkingDocument(
      [{ ...record(PRIOR_ROOT, 1, {}), documentId: 'doc:two' }],
      'doc:two',
      valid
    )
  ).toThrow(PersistenceContractError)
})

test('termination injection validates hashes and never widens invalid filters', () => {
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new TypeError('hostile termination hash')
      }
    }
  )
  for (const seed of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, hostile]) {
    expect(() => Reflect.apply(createTerminationInjector, undefined, [seed])).toThrow(
      PersistenceContractError
    )
  }
  for (const contentRootHash of [
    '',
    'A'.repeat(64),
    'a'.repeat(63),
    `${'a'.repeat(63)}g`,
    null,
    hostile
  ]) {
    expect(() => Reflect.apply(createTerminationInjector, undefined, [0, contentRootHash])).toThrow(
      PersistenceContractError
    )
  }

  const targeted = createTerminationInjector(0, PRIOR_ROOT)
  expect(() => targeted('asset', NEXT_ROOT)).not.toThrow()
  expect(() => targeted('asset', PRIOR_ROOT)).toThrow(PersistenceTerminationError)
  const wildcard = createTerminationInjector(0)
  expect(() => wildcard('asset', NEXT_ROOT)).toThrow(PersistenceTerminationError)
  expect(() => Reflect.apply(targeted, undefined, ['asset', ''])).toThrow(PersistenceContractError)
  expect(() => Reflect.apply(targeted, undefined, ['invalid', PRIOR_ROOT])).toThrow(
    PersistenceContractError
  )
})

test('estimateJSONOverhead accepts plain data objects only with typed failures', () => {
  const accessor = Object.defineProperty({}, 'value', {
    enumerable: true,
    get() {
      throw new TypeError('payload getter')
    }
  })
  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw new TypeError('payload proxy')
      }
    }
  )
  for (const payload of [null, undefined, 1, 'value', [], accessor, hostile]) {
    expect(() => Reflect.apply(estimateJSONOverhead, undefined, [payload])).toThrow(
      PersistenceContractError
    )
  }
  expect(estimateJSONOverhead(Object.create(null))).toBe(0)
  expect(estimateJSONOverhead({ value: 1 })).toBe(8)
})

test('persistence-v1 record recovery ignores unacknowledged embedded data URLs', () => {
  const acknowledged = record(PRIOR_ROOT, 1, { title: 'A1' })
  const unacknowledged = record(NEXT_ROOT, 2, { image: PNG_DATA_URL, title: 'B2' })

  expect(
    recoverWorkingDocument(
      [acknowledged, unacknowledged],
      acknowledged.documentId,
      acknowledgement(acknowledged)
    )
  ).toEqual(acknowledged)
  expect(() =>
    recoverWorkingDocument(
      [unacknowledged],
      unacknowledged.documentId,
      acknowledgement(unacknowledged)
    )
  ).toThrow(PersistenceMigrationError)
})
