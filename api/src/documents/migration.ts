import {
  type HostedAssetRecord,
  type HostedDocumentMetadataBundle,
  type HostedDocumentRecord,
  type HostedDocumentSourceFormat,
  type HostedMigrationKind,
  type HostedMigrationRecord,
  type HostedMigrationSourceKind,
  type HostedSnapshotReason,
  type HostedSnapshotRecord,
  documentAssetStorageKey,
  documentSnapshotStorageKey
} from './schema'

export type HostedDocumentMigrationErrorCode =
  | 'missing-owner'
  | 'unsupported-source-format'
  | 'unsupported-transition'
  | 'missing-source-metadata'
  | 'missing-asset-metadata'
  | 'missing-snapshot-bytes'

export class HostedDocumentMigrationError extends Error {
  constructor(
    readonly code: HostedDocumentMigrationErrorCode,
    message: string,
    readonly details: { transition: HostedDocumentTransition; sourceKind?: string; sourceFormat?: string }
  ) {
    super(message)
    this.name = 'HostedDocumentMigrationError'
  }
}

export type HostedDocumentTransition =
  | 'create-empty'
  | 'import-local'
  | 'promote-local'
  | 'duplicate-hosted'
  | 'local-open'
  | 'hosted-room-join'

export type LocalDocumentSourceDescriptor = {
  kind: Exclude<HostedMigrationSourceKind, 'hosted-document'>
  format: HostedDocumentSourceFormat
  name: string | null
  fingerprint: string | null
}

export type HostedDocumentAssetInput = {
  id: string
  kind: HostedAssetRecord['kind']
  contentHash: string
  byteLength: number
  mediaType: string
}

export type HostedDocumentMigrationInput = {
  transition: Extract<HostedDocumentTransition, 'create-empty' | 'import-local' | 'promote-local' | 'duplicate-hosted'>
  ownerUserId: string | null
  documentId: string
  snapshotId: string
  title: string
  source: LocalDocumentSourceDescriptor | { kind: 'hosted-document'; format: HostedDocumentSourceFormat; name: string | null; fingerprint: string | null }
  snapshotBytes: Uint8Array | null
  snapshotContentHash: string
  parentSnapshotId?: string | null
  assets?: HostedDocumentAssetInput[]
  now?: string
}

const transitionToMigrationKind: Record<HostedDocumentMigrationInput['transition'], HostedMigrationKind> = {
  'create-empty': 'create-empty',
  'import-local': 'import-local',
  'promote-local': 'promote-local',
  'duplicate-hosted': 'duplicate-hosted'
}

const transitionToSnapshotReason: Record<HostedDocumentMigrationInput['transition'], HostedSnapshotReason> = {
  'create-empty': 'initial-import',
  'import-local': 'initial-import',
  'promote-local': 'initial-import',
  'duplicate-hosted': 'duplicate'
}

export function createHostedDocumentMetadata(
  input: HostedDocumentMigrationInput
): HostedDocumentMetadataBundle {
  validateHostedDocumentMigrationInput(input)

  const createdAt = input.now ?? new Date().toISOString()
  const storageKey = documentSnapshotStorageKey(input.documentId, input.snapshotId)
  const ownerUserId = input.ownerUserId as string
  const snapshotBytes = input.snapshotBytes as Uint8Array
  const assets = input.assets ?? []

  const document: HostedDocumentRecord = {
    id: input.documentId,
    ownerUserId,
    title: input.title,
    sourceFormat: input.source.format,
    currentSnapshotId: input.snapshotId,
    currentSnapshotStorageKey: storageKey,
    lifecycleState: 'active',
    createdAt,
    updatedAt: createdAt
  }

  const snapshot: HostedSnapshotRecord = {
    id: input.snapshotId,
    documentId: input.documentId,
    ownerUserId,
    parentSnapshotId: input.parentSnapshotId ?? null,
    storageKey,
    byteLength: snapshotBytes.byteLength,
    contentHash: input.snapshotContentHash,
    reason: transitionToSnapshotReason[input.transition],
    createdAt
  }

  const migration: HostedMigrationRecord = {
    id: `${input.documentId}:migration:${input.snapshotId}`,
    documentId: input.documentId,
    ownerUserId,
    kind: transitionToMigrationKind[input.transition],
    sourceKind: input.source.kind,
    sourceFormat: input.source.format,
    sourceName: input.source.name,
    sourceFingerprint: input.source.fingerprint,
    initialSnapshotId: input.snapshotId,
    state: 'complete',
    errorCode: null,
    createdAt,
    completedAt: createdAt
  }

  return {
    document,
    snapshot,
    assets: assets.map((asset) => ({
      id: asset.id,
      documentId: input.documentId,
      ownerUserId,
      snapshotId: input.snapshotId,
      kind: asset.kind,
      storageKey: documentAssetStorageKey(input.documentId, asset.id),
      contentHash: asset.contentHash,
      byteLength: asset.byteLength,
      mediaType: asset.mediaType,
      createdAt
    })),
    migration
  }
}

export function rejectUnsupportedHostedDocumentTransition(
  transition: Exclude<HostedDocumentTransition, HostedDocumentMigrationInput['transition']>,
  sourceKind?: string,
  sourceFormat?: string
): never {
  throw new HostedDocumentMigrationError(
    'unsupported-transition',
    `${transition} is not a legal local-to-hosted document metadata transition.`,
    { transition, sourceKind, sourceFormat }
  )
}

function validateHostedDocumentMigrationInput(input: HostedDocumentMigrationInput) {
  if (!input.ownerUserId) {
    throw new HostedDocumentMigrationError('missing-owner', 'Hosted documents require owner user.id.', {
      transition: input.transition,
      sourceKind: input.source.kind,
      sourceFormat: input.source.format
    })
  }

  if (input.source.format !== 'fig' && input.source.format !== 'pen') {
    throw new HostedDocumentMigrationError(
      'unsupported-source-format',
      'Hosted import supports only normalized .fig or .pen sources.',
      { transition: input.transition, sourceKind: input.source.kind, sourceFormat: input.source.format }
    )
  }

  if (!input.snapshotBytes?.byteLength) {
    throw new HostedDocumentMigrationError(
      'missing-snapshot-bytes',
      'Hosted document metadata requires the initial snapshot bytes before D1 records are created.',
      { transition: input.transition, sourceKind: input.source.kind, sourceFormat: input.source.format }
    )
  }

  if (
    input.transition !== 'create-empty' &&
    input.source.kind !== 'untitled-memory' &&
    !input.source.name &&
    !input.source.fingerprint
  ) {
    throw new HostedDocumentMigrationError(
      'missing-source-metadata',
      'Local-to-hosted migration requires source name or fingerprint provenance.',
      { transition: input.transition, sourceKind: input.source.kind, sourceFormat: input.source.format }
    )
  }

  for (const asset of input.assets ?? []) {
    if (!asset.contentHash || asset.byteLength <= 0 || !asset.mediaType) {
      throw new HostedDocumentMigrationError(
        'missing-asset-metadata',
        'Hosted asset records require content hash, byte length, and media type.',
        { transition: input.transition, sourceKind: input.source.kind, sourceFormat: input.source.format }
      )
    }
  }
}
