import {
  type DocumentBackend,
  DocumentBackendOperationError,
  type DocumentBackendMetadata,
  type DocumentOpenRequest,
  type DocumentOpenResult,
  createCapabilityPolicies,
  createOperationPolicies,
  requireDocumentBackendOperation
} from '@/app/document/io/backend'

export type HostedDocumentDescriptor = {
  documentId: string
  latestSnapshotId: string | null
  sourceFormat: string
  displayName?: string
}

export type HostedDocumentClient = {
  loadMetadata(documentId: string): Promise<DocumentBackendMetadata>
  open(documentId: string): Promise<DocumentOpenResult>
  save(documentId: string, data: Uint8Array): Promise<HostedDocumentDescriptor>
  saveAs(data: Uint8Array): Promise<HostedDocumentDescriptor>
  autosave(documentId: string, data: Uint8Array): Promise<HostedDocumentDescriptor>
}

export type HostedDocumentBackendOptions = {
  descriptor: HostedDocumentDescriptor | null
  client?: HostedDocumentClient
}

export function createHostedDocumentBackend({
  descriptor,
  client
}: HostedDocumentBackendOptions): DocumentBackend {
  const backend: DocumentBackend = {
    id: 'hosted-document',
    mode: 'hosted-docs single-user',
    operations: createOperationPolicies({
      open: {
        legal: true,
        reason: 'Hosted documents open by canonical document.id through hosted document service.'
      },
      save: {
        legal: true,
        reason: 'Hosted save writes metadata and latest snapshot for document.id.'
      },
      saveAs: {
        legal: true,
        reason: 'Hosted saveAs creates an explicit hosted copy/import target.'
      },
      autosave: {
        legal: true,
        reason: 'Hosted autosave writes snapshot through hosted document service.'
      },
      loadMetadata: {
        legal: true,
        reason: 'Hosted metadata loads by canonical document.id.'
      }
    }),
    capabilities: createCapabilityPolicies(
      ['hostedOpen', 'hostedSave', 'hostedAutosave', 'metadataLoad', 'browserDownloadFallback'],
      {
        localFileOpen:
          'Hosted backend must not open local files or silently promote local .fig/.pen sources.',
        localFileSave:
          'Hosted backend save targets hosted snapshots; local save remains explicit export/copy action.'
      }
    ),
    can: (operation) => backend.operations[operation].legal,
    hasCapability: (capability) => backend.capabilities[capability].supported,
    getMetadata,
    loadMetadata,
    open,
    save,
    saveAs,
    autosave
  }

  function getMetadata(): DocumentBackendMetadata {
    return {
      mode: backend.mode,
      displayName: descriptor?.displayName,
      sourceFormat: descriptor?.sourceFormat,
      hosted: descriptor
        ? {
            documentId: descriptor.documentId,
            latestSnapshotId: descriptor.latestSnapshotId,
            sourceFormat: descriptor.sourceFormat
          }
        : undefined
    }
  }

  async function loadMetadata() {
    requireDocumentBackendOperation(backend, 'loadMetadata')
    const documentId = requireHostedDocumentId('loadMetadata')
    if (!client) return getMetadata()
    return client.loadMetadata(documentId)
  }

  async function open(request: DocumentOpenRequest): Promise<DocumentOpenResult | null> {
    requireDocumentBackendOperation(backend, 'open')
    if (request.kind === 'file') {
      throw new DocumentBackendOperationError(
        'illegal-operation',
        'Hosted backend cannot open local files; use explicit import/promote flow.',
        { backendId: backend.id, mode: backend.mode, operation: 'open:file' }
      )
    }
    const documentId = requireHostedDocumentId('open')
    if (!client) throwHostedRuntimeUnavailable('open')
    return client.open(documentId)
  }

  async function save(data: Uint8Array) {
    requireDocumentBackendOperation(backend, 'save')
    const documentId = requireHostedDocumentId('save')
    if (!client) throwHostedRuntimeUnavailable('save')
    descriptor = await client.save(documentId, data)
  }

  async function saveAs(data: Uint8Array) {
    requireDocumentBackendOperation(backend, 'saveAs')
    if (!client) throwHostedRuntimeUnavailable('saveAs')
    descriptor = await client.saveAs(data)
  }

  async function autosave(data: Uint8Array) {
    requireDocumentBackendOperation(backend, 'autosave')
    const documentId = requireHostedDocumentId('autosave')
    if (!client) throwHostedRuntimeUnavailable('autosave')
    descriptor = await client.autosave(documentId, data)
  }

  function requireHostedDocumentId(operation: string) {
    if (descriptor?.documentId) return descriptor.documentId
    throw new DocumentBackendOperationError(
      'missing-source',
      'Hosted backend operation requires canonical hosted document.id.',
      { backendId: backend.id, mode: backend.mode, operation }
    )
  }

  function throwHostedRuntimeUnavailable(operation: string): never {
    throw new DocumentBackendOperationError(
      'hosted-runtime-unavailable',
      'Hosted document runtime is not wired in this app-side readiness slice.',
      { backendId: backend.id, mode: backend.mode, operation }
    )
  }

  return backend
}
