import type { SceneGraph } from '@open-pencil/core/scene-graph'

export type DocumentOperatingMode =
  | 'local-only'
  | 'hosted-auth + local-docs'
  | 'hosted-docs single-user'
  | 'hosted-collab'

export type DocumentBackendOperation = 'open' | 'save' | 'saveAs' | 'autosave' | 'loadMetadata'

export type DocumentBackendCapability =
  | 'localFileOpen'
  | 'localFileSave'
  | 'browserDownloadFallback'
  | 'hostedOpen'
  | 'hostedSave'
  | 'hostedAutosave'
  | 'metadataLoad'

export type DocumentBackendErrorCode =
  | 'illegal-operation'
  | 'missing-capability'
  | 'hosted-runtime-unavailable'
  | 'missing-source'

export type DocumentOperationPolicy = {
  legal: boolean
  reason: string
}

export type DocumentCapabilityPolicy = {
  supported: boolean
  reason: string
}

export type DocumentBackendMetadata = {
  mode: DocumentOperatingMode
  sourceFormat?: string
  displayName?: string
  local?: {
    filePath: string | null
    fileHandleName: string | null
    downloadName: string | null
  }
  hosted?: {
    documentId: string
    latestSnapshotId: string | null
    sourceFormat: string
  }
}

export type DocumentOpenRequest =
  | {
      kind: 'file'
      file: File
      handle?: FileSystemFileHandle
      path?: string
    }
  | { kind: 'reload' }

export type DocumentOpenResult = {
  graph: SceneGraph
  fileName: string
  sourceFormat: string
  handle?: FileSystemFileHandle
  path?: string
}

export interface DocumentBackend {
  id: string
  mode: DocumentOperatingMode
  operations: Record<DocumentBackendOperation, DocumentOperationPolicy>
  capabilities: Record<DocumentBackendCapability, DocumentCapabilityPolicy>
  can(operation: DocumentBackendOperation): boolean
  hasCapability(capability: DocumentBackendCapability): boolean
  getMetadata(): DocumentBackendMetadata
  loadMetadata(): Promise<DocumentBackendMetadata>
  open(request: DocumentOpenRequest): Promise<DocumentOpenResult | null>
  save(data: Uint8Array): Promise<void>
  saveAs(data: Uint8Array): Promise<void>
  autosave(data: Uint8Array): Promise<void>
}

export class DocumentBackendOperationError extends Error {
  constructor(
    readonly code: DocumentBackendErrorCode,
    message: string,
    readonly details: { backendId: string; mode: DocumentOperatingMode; operation?: string }
  ) {
    super(message)
    this.name = 'DocumentBackendOperationError'
  }
}

export function requireDocumentBackendOperation(
  backend: DocumentBackend,
  operation: DocumentBackendOperation
) {
  const policy = backend.operations[operation]
  if (policy.legal) return
  throw new DocumentBackendOperationError('illegal-operation', policy.reason, {
    backendId: backend.id,
    mode: backend.mode,
    operation
  })
}

export function requireDocumentBackendCapability(
  backend: DocumentBackend,
  capability: DocumentBackendCapability
) {
  const policy = backend.capabilities[capability]
  if (policy.supported) return
  throw new DocumentBackendOperationError('missing-capability', policy.reason, {
    backendId: backend.id,
    mode: backend.mode,
    operation: capability
  })
}

export function createOperationPolicies(
  overrides: Partial<Record<DocumentBackendOperation, DocumentOperationPolicy>> = {}
): Record<DocumentBackendOperation, DocumentOperationPolicy> {
  return {
    open: { legal: true, reason: 'Documents may open in this operating mode.' },
    save: { legal: true, reason: 'Primary save is legal in this operating mode.' },
    saveAs: { legal: true, reason: 'Explicit copy/export save is legal in this operating mode.' },
    autosave: { legal: true, reason: 'Autosave is legal when writable source exists.' },
    loadMetadata: { legal: true, reason: 'Metadata detection is legal in this operating mode.' },
    ...overrides
  }
}

export function createCapabilityPolicies(
  supported: DocumentBackendCapability[],
  reasonByCapability: Partial<Record<DocumentBackendCapability, string>> = {}
): Record<DocumentBackendCapability, DocumentCapabilityPolicy> {
  const allCapabilities: DocumentBackendCapability[] = [
    'localFileOpen',
    'localFileSave',
    'browserDownloadFallback',
    'hostedOpen',
    'hostedSave',
    'hostedAutosave',
    'metadataLoad'
  ]
  return Object.fromEntries(
    allCapabilities.map((capability) => {
      const isSupported = supported.includes(capability)
      return [
        capability,
        {
          supported: isSupported,
          reason:
            reasonByCapability[capability] ??
            (isSupported
              ? `${capability} is supported by this backend.`
              : `${capability} is not legal for this backend and operating mode.`)
        }
      ]
    })
  ) as Record<DocumentBackendCapability, DocumentCapabilityPolicy>
}
