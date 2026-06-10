import { decodeBase64, encodeBase64 } from '../wire/base64'
import { buildSubprotocols } from '../wire/protocol'
import { FEDERATION_SURFACE_NAME, FEDERATION_SURFACE_VERSION } from '../version'
import { HostedApiError, SessionError, type SessionErrorCode } from '../errors'
import type { HostedDocumentDescriptor, HostedDocumentSourceFormat, HostedSnapshotReason } from '../types'
import type {
  HostedDocumentOpenResult,
  HostedDocumentCreateOptions,
  DocumentClient
} from './document-client'
import type { AssetClient, AssetWriteRequest, AssetWriteResult } from './asset-client'
import type {
  HostedRoomConnection,
  LoadedHostedSnapshot,
  RoomClient
} from './room-client'
import type { SessionClient, SessionStateResolved } from './session-client'
import type { SessionResolveOutcome, SessionUser } from '../types/session'

/**
 * Public options for {@link createFederationClient}. Sub-apps pass their
 * API origin and a function that returns the current ELF token (cookie
 * reader, in-memory store, or stub for tests).
 *
 * The `fetchImpl` and `WebSocketImpl` slots let sub-apps wire in
 * platform-specific transports (Node, Tauri, SSR, custom proxies). When
 * omitted, the global `fetch` and `WebSocket` are used.
 */
export type CreateFederationClientOptions = {
  apiOrigin: string
  getToken: () => string | null | undefined
  fetchImpl?: typeof fetch
  WebSocketImpl?: typeof WebSocket
}

export type FederationClient = {
  session: SessionClient
  documents: DocumentClient
  assets: AssetClient
  rooms: RoomClient
  surface: { name: string; version: string }
}

const USER_AGENT = `${FEDERATION_SURFACE_NAME}@${FEDERATION_SURFACE_VERSION}`

export function createFederationClient(options: CreateFederationClientOptions): FederationClient {
  const { apiOrigin, getToken } = options
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const webSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket

  if (typeof fetchImpl !== 'function') {
    throw new TypeError('createFederationClient: fetchImpl must be a function')
  }
  if (typeof webSocketImpl !== 'function') {
    throw new TypeError('createFederationClient: WebSocketImpl must be a constructor')
  }

  const buildHeaders = (): Headers => {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-Federation-Surface': USER_AGENT
    })
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return headers
  }

  const requestJson = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const url = `${apiOrigin}${path}`
    const init: RequestInit = {
      method,
      headers: buildHeaders(),
      credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }
    let response: Response
    try {
      response = await fetchImpl(url, init)
    } catch (cause) {
      throw new HostedApiError(0, 'network-error', 'Network request failed.', { cause: String(cause) })
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null
      throw new HostedApiError(
        response.status,
        payload?.error ?? 'unknown',
        payload?.message ?? response.statusText
      )
    }
    return (await response.json()) as T
  }

  const session: SessionClient = {
    async resolve() {
      try {
        const body = await requestJson<{ user: SessionUser | null; mode?: string }>('GET', '/api/session')
        if (!body.user) return { type: 'unauthenticated' }
        return { type: 'authenticated', userId: body.user.id, token: getToken() ?? '' }
      } catch (error) {
        if (error instanceof HostedApiError) {
          if (error.code === 'network-error') throw error
          const code: SessionErrorCode =
            error.status === 401
              ? 'invalid-token'
              : 'session-bootstrap-failed'
          throw new SessionError(code, error.message)
        }
        throw new SessionError('session-bootstrap-failed', 'Unknown session bootstrap error.')
      }
    },
    async state(): Promise<SessionStateResolved> {
      try {
        const outcome = await session.resolve()
        if (outcome.type === 'authenticated') {
          return { status: 'authenticated', user: { id: outcome.userId } }
        }
        if (outcome.type === 'unauthenticated') {
          return { status: 'unauthenticated' }
        }
        return { status: 'error' }
      } catch {
        return { status: 'error' }
      }
    },
    async currentUser() {
      const outcome = await session.resolve()
      return outcome.type === 'authenticated' ? { id: outcome.userId } : null
    }
  }

  const documents: DocumentClient = {
    async list({ limit = 50 } = {}) {
      const body = await requestJson<{ documents: Array<{ id: string; title: string; sourceFormat: string; currentSnapshotId: string; updatedAt: string }> }>(
        'GET',
        `/api/documents?limit=${encodeURIComponent(String(limit))}`
      )
      return body.documents.map((row) => ({
        documentId: row.id,
        latestSnapshotId: row.currentSnapshotId,
        sourceFormat: row.sourceFormat,
        displayName: row.title
      }))
    },

    async loadMetadata(documentId) {
      const body = await requestJson<{
        document: { id: string; title: string; sourceFormat: HostedDocumentSourceFormat; currentSnapshotId: string }
      }>('GET', `/api/documents/${encodeURIComponent(documentId)}/snapshot`)
      return {
        sourceFormat: body.document.sourceFormat,
        displayName: body.document.title,
        hosted: {
          documentId: body.document.id,
          latestSnapshotId: body.document.currentSnapshotId,
          sourceFormat: body.document.sourceFormat
        }
      }
    },

    async open(documentId) {
      const body = await requestJson<{
        document: HostedDocumentOpenResult['document']
        snapshot: { id: string; bytesBase64: string }
        assets: Array<{ id: string; status: 'ready' | 'missing'; bytesBase64: string | null }>
        hydration: { degraded: boolean; missingAssetIds: string[]; message: string | null }
      }>('GET', `/api/documents/${encodeURIComponent(documentId)}/snapshot`)

      return {
        document: body.document,
        snapshotBytes: decodeBase64(body.snapshot.bytesBase64),
        assets: body.assets.map((asset) => ({
          id: asset.id,
          status: asset.status,
          bytes: asset.bytesBase64 ? decodeBase64(asset.bytesBase64) : null
        })),
        hydration: body.hydration
      }
    },

    async save(documentId, data, reason = 'manual-save') {
      const body = await requestJson<{ documentId: string; snapshotId: string }>(
        'PUT',
        `/api/documents/${encodeURIComponent(documentId)}/snapshot`,
        {
          snapshotId: generateSnapshotId(),
          snapshotBytesBase64: encodeBase64(data),
          reason
        }
      )
      return {
        documentId: body.documentId,
        latestSnapshotId: body.snapshotId,
        sourceFormat: 'fig'
      }
    },

    async saveAs(data, options: HostedDocumentCreateOptions = {}) {
      const body = await requestJson<{ documentId: string; snapshotId: string }>('POST', '/api/documents', {
        documentId: generateDocumentId(),
        snapshotId: generateSnapshotId(),
        title: options.title ?? 'Untitled',
        sourceFormat: options.sourceFormat ?? 'fig',
        snapshotBytesBase64: encodeBase64(data),
        sourceKind: options.sourceKind ?? 'untitled-memory',
        sourceName: options.sourceName ?? null,
        sourceFingerprint: options.sourceFingerprint ?? null
      })
      return {
        documentId: body.documentId,
        latestSnapshotId: body.snapshotId,
        sourceFormat: options.sourceFormat ?? 'fig'
      }
    },

    async delete(documentId) {
      const body = await requestJson<{ documentId: string; deleted: true }>(
        'DELETE',
        `/api/documents/${encodeURIComponent(documentId)}`
      )
      return body
    }
  }

  const assets: AssetClient = {
    async write(request: AssetWriteRequest): Promise<AssetWriteResult> {
      const body = await requestJson<AssetWriteResult>(
        'POST',
        `/api/documents/${encodeURIComponent(request.documentId)}/assets`,
        {
          assetId: request.assetId,
          snapshotId: request.snapshotId,
          kind: request.kind,
          bytesBase64: encodeBase64(request.bytes),
          mediaType: request.mediaType
        }
      )
      return body
    },
    async delete(documentId, assetId) {
      const body = await requestJson<{ assetId: string; deleted: true }>(
        'DELETE',
        `/api/documents/${encodeURIComponent(documentId)}/assets/${encodeURIComponent(assetId)}`
      )
      return body
    }
  }

  const rooms: RoomClient = {
    async loadSnapshot(documentId): Promise<LoadedHostedSnapshot> {
      const body = await requestJson<{
        document: { id: string; title: string; sourceFormat: string; currentSnapshotId: string; updatedAt: string }
        snapshot: { id: string; bytesBase64: string }
        assets: Array<{ id: string; status: 'ready' | 'missing'; bytesBase64: string | null }>
        hydration: { degraded: boolean; missingAssetIds: string[]; message: string | null }
      }>('GET', `/api/documents/${encodeURIComponent(documentId)}/snapshot`)

      return {
        document: body.document,
        snapshot: {
          id: body.snapshot.id,
          bytes: decodeBase64(body.snapshot.bytesBase64)
        },
        assets: body.assets.map((asset) => ({
          id: asset.id,
          status: asset.status,
          bytes: asset.bytesBase64 ? decodeBase64(asset.bytesBase64) : null
        })),
        hydration: body.hydration
      }
    },

    async resolveConnection(documentId): Promise<HostedRoomConnection> {
      const url = new URL(`${apiOrigin}/api/documents/${encodeURIComponent(documentId)}/room`)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const token = getToken()
      return {
        url: url.toString(),
        protocols: buildSubprotocols(token),
        roomId: documentId
      }
    }
  }

  return {
    session,
    documents,
    assets,
    rooms,
    surface: {
      name: FEDERATION_SURFACE_NAME,
      version: FEDERATION_SURFACE_VERSION
    }
  }
}

function generateDocumentId(): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(16).slice(2, 18)
  return `doc_${uuid}`
}

function generateSnapshotId(): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(16).slice(2, 18)
  return `snap_${uuid}`
}

export type { SessionResolveOutcome, HostedDocumentDescriptor, HostedSnapshotReason }
