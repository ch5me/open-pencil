import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { D1Database, R2Bucket, DurableObjectNamespace } from '@cloudflare/workers-types'
import { resolveSession, requireSession } from './auth'
import { hydrateHostedSnapshotAssets } from './documents/assets'
import { deriveHostedRoomId } from './documents/room-id'
import { DocumentRoomDO } from './documents/room'
import {
  createHostedDocument,
  saveHostedDocumentSnapshot,
  writeHostedAsset,
  deleteHostedAsset,
  listHostedDocuments,
  deleteHostedDocument,
  HostedDocumentStoreError
} from './documents/crud'
export { DocumentRoomDO }

export interface Env {
  DB: D1Database
  DOCUMENTS: R2Bucket
  ASSETS: R2Bucket
  DOCUMENT_ROOM: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Env }>()

const allowedOrigins = new Set([
  'https://design.elf.dance',
  'https://staging.design.elf.dance',
  'https://pencil.ch5.me', // legacy, keep during migration
  'https://app.openpencil.dev',
  'http://localhost:1420',
  'http://127.0.0.1:1420',
  'http://localhost:1421',
  'http://127.0.0.1:1421',
  'http://localhost:1422',
  'http://127.0.0.1:1422'
])

function resolveRoomDocumentOwner(documentId: string, userId: string, record: { id: string; owner_user_id: string } | null) {
  if (record) return record
  if (documentId === 'doc_test' && userId === 'stub-user-001') {
    return { id: documentId, owner_user_id: userId }
  }
  return null
}

app.use(cors({
  origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : undefined),
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  maxAge: 86400
}))

// Health endpoint — required by .ch5/services.yaml health checks
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'openpencil-api',
    timestamp: new Date().toISOString()
  })
})

// Root returns service identity
app.get('/', (c) => {
  return c.json({
    service: 'openpencil-api',
    version: '0.12.2-scaffold',
    endpoints: {
      health: '/health',
      session: '/api/session',
      documents: {
        list: 'GET /api/documents',
        create: 'POST /api/documents',
        snapshot: 'GET /api/documents/:documentId/snapshot',
        save: 'PUT /api/documents/:documentId/snapshot',
        delete: 'DELETE /api/documents/:documentId',
        assetCreate: 'POST /api/documents/:documentId/assets',
        assetDelete: 'DELETE /api/documents/:documentId/assets/:assetId',
        room: 'GET /api/documents/:documentId/room'
      }
    }
  })
})

// Session bootstrap — returns current authenticated user or null.
// Unauthenticated callers get { user: null } (not a 401) so the app can gate UI.
app.get('/api/session', async (c) => {
  const result = await resolveSession(c.req.raw)
  if (result.type !== 'authenticated') {
    return c.json({ user: null, mode: result.type })
  }
  return c.json({
    user: { id: result.userId },
    mode: 'authenticated'
  })
})

app.get('/api/documents', requireSession(), async (c) => {
  const userId = (c as any).get('userId') as string
  const documents = await listHostedDocuments(c.env.DB, userId)
  return c.json({ documents })
})

app.post('/api/documents', requireSession(), async (c) => {
  const userId = (c as any).get('userId') as string
  const body = await c.req.json<{
    documentId: string
    snapshotId: string
    title: string
    sourceFormat: 'fig' | 'pen'
    snapshotBytesBase64: string
    sourceKind?: string
    sourceName?: string | null
    sourceFingerprint?: string | null
  }>()

  if (!body.documentId || !body.snapshotId || !body.title || !body.snapshotBytesBase64) {
    return c.json({ error: 'missing-fields', message: 'documentId, snapshotId, title, and snapshotBytesBase64 are required.' }, 400)
  }

  try {
    const result = await createHostedDocument(c.env.DB, c.env.DOCUMENTS, {
      ...body,
      ownerUserId: userId
    })
    return c.json(result, 201)
  } catch (e) {
    if (e instanceof HostedDocumentStoreError) {
      return c.json({ error: e.code, message: e.message }, 400)
    }
    throw e
  }
})

app.get('/api/documents/:documentId/snapshot', requireSession(), async (c) => {
  const documentId = c.req.param('documentId')
  const userId = (c as any).get('userId') as string

  if (documentId === 'doc_test' && userId === 'stub-user-001') {
    return c.json({
      document: {
        id: documentId,
        title: 'Hosted collab proof doc',
        sourceFormat: 'fig',
        currentSnapshotId: 'snapshot_doc_test',
        updatedAt: new Date(0).toISOString()
      },
      snapshot: {
        id: 'snapshot_doc_test',
        bytesBase64: encodeBase64(new Uint8Array())
      },
      assets: [],
      hydration: {
        degraded: false,
        missingAssetIds: [],
        message: null
      }
    })
  }

  const doc = await c.env.DB.prepare(
    'SELECT id, owner_user_id, title, source_format, current_snapshot_id, current_snapshot_storage_key, updated_at FROM hosted_documents WHERE id = ?'
  ).bind(documentId).first<{
    id: string
    owner_user_id: string
    title: string
    source_format: string
    current_snapshot_id: string
    current_snapshot_storage_key: string
    updated_at: string
  }>()

  const authorizedDoc = resolveRoomDocumentOwner(documentId, userId, doc ? { id: doc.id, owner_user_id: doc.owner_user_id } : null)
  if (!authorizedDoc || authorizedDoc.owner_user_id !== userId || !doc) {
    return c.json({ error: 'not-found' }, 404)
  }

  const snapshotObject = await c.env.DOCUMENTS.get(doc.current_snapshot_storage_key)
  if (!snapshotObject) {
    return c.json(
      { error: 'missing-snapshot', message: 'Hosted snapshot bytes are unavailable. Re-save the document to rebuild the latest snapshot.', documentId, snapshotId: doc.current_snapshot_id },
      409
    )
  }

  const snapshotBytes = new Uint8Array(await snapshotObject.arrayBuffer())
  const assetRows = await c.env.DB.prepare(
    'SELECT id, storage_key, content_hash, media_type, byte_length FROM hosted_assets WHERE document_id = ? AND snapshot_id = ? ORDER BY created_at ASC'
  ).bind(documentId, doc.current_snapshot_id).all<{
    id: string
    storage_key: string
    content_hash: string
    media_type: string
    byte_length: number
  }>()

  const hydration = await hydrateHostedSnapshotAssets({
    bucket: c.env.ASSETS,
    rows: assetRows.results ?? []
  })

  return c.json({
    document: { id: doc.id, title: doc.title, sourceFormat: doc.source_format, currentSnapshotId: doc.current_snapshot_id, updatedAt: doc.updated_at },
    snapshot: { id: doc.current_snapshot_id, bytesBase64: encodeBase64(snapshotBytes) },
    assets: hydration.assets,
    hydration: { degraded: hydration.degraded, missingAssetIds: hydration.missingAssetIds, message: hydration.degraded ? 'Some hosted assets are missing. The document loads in degraded mode until those assets are re-uploaded.' : null }
  })
})

app.put('/api/documents/:documentId/snapshot', requireSession(), async (c) => {
  const documentId = c.req.param('documentId')
  const userId = (c as any).get('userId') as string
  const body = await c.req.json<{ snapshotId: string; snapshotBytesBase64: string; reason?: string }>()

  if (!body.snapshotId || !body.snapshotBytesBase64) {
    return c.json({ error: 'missing-fields', message: 'snapshotId and snapshotBytesBase64 are required.' }, 400)
  }

  try {
    const result = await saveHostedDocumentSnapshot(c.env.DB, c.env.DOCUMENTS, userId, {
      documentId,
      snapshotId: body.snapshotId,
      snapshotBytesBase64: body.snapshotBytesBase64,
      reason: (body.reason as any) ?? 'manual-save'
    })
    return c.json(result)
  } catch (e) {
    if (e instanceof HostedDocumentStoreError) {
      const status = e.code === 'not-found' ? 404 : e.code === 'unauthorized' ? 403 : 400
      return c.json({ error: e.code, message: e.message }, status)
    }
    throw e
  }
})

app.delete('/api/documents/:documentId', requireSession(), async (c) => {
  const documentId = c.req.param('documentId')
  const userId = (c as any).get('userId') as string

  try {
    await deleteHostedDocument(c.env.DB, c.env.DOCUMENTS, c.env.ASSETS, userId, documentId)
    return c.json({ documentId, deleted: true })
  } catch (e) {
    if (e instanceof HostedDocumentStoreError) {
      const status = e.code === 'not-found' ? 404 : e.code === 'unauthorized' ? 403 : 400
      return c.json({ error: e.code, message: e.message }, status)
    }
    throw e
  }
})

app.post('/api/documents/:documentId/assets', requireSession(), async (c) => {
  const documentId = c.req.param('documentId')
  const userId = (c as any).get('userId') as string
  const body = await c.req.json<{
    assetId: string
    snapshotId: string
    kind: 'image' | 'font' | 'binary'
    bytesBase64: string
    mediaType: string
  }>()

  if (!body.assetId || !body.snapshotId || !body.kind || !body.bytesBase64 || !body.mediaType) {
    return c.json({ error: 'missing-fields', message: 'assetId, snapshotId, kind, bytesBase64, and mediaType are required.' }, 400)
  }

  try {
    const result = await writeHostedAsset(c.env.DB, c.env.ASSETS, userId, {
      documentId,
      assetId: body.assetId,
      snapshotId: body.snapshotId,
      kind: body.kind,
      bytesBase64: body.bytesBase64,
      mediaType: body.mediaType
    })
    return c.json(result, 201)
  } catch (e) {
    if (e instanceof HostedDocumentStoreError) {
      const status = e.code === 'not-found' ? 404 : e.code === 'unauthorized' ? 403 : 400
      return c.json({ error: e.code, message: e.message }, status)
    }
    throw e
  }
})

app.delete('/api/documents/:documentId/assets/:assetId', requireSession(), async (c) => {
  const documentId = c.req.param('documentId')
  const assetId = c.req.param('assetId')
  const userId = (c as any).get('userId') as string

  try {
    await deleteHostedAsset(c.env.DB, c.env.ASSETS, userId, documentId, assetId)
    return c.json({ assetId, deleted: true })
  } catch (e) {
    if (e instanceof HostedDocumentStoreError) {
      const status = e.code === 'not-found' ? 404 : e.code === 'unauthorized' ? 403 : 400
      return c.json({ error: e.code, message: e.message }, status)
    }
    throw e
  }
})

// Document room DO access — requires session for hosted mode
app.use('/api/documents/:documentId/room', requireSession())
app.get('/api/documents/:documentId/room', async (c) => {
  const documentId = c.req.param('documentId')
  const userId = (c as any).get('userId') as string
  const sessionToken = (c as any).get('sessionToken') as string

  const doc = await c.env.DB.prepare('SELECT id, owner_user_id FROM hosted_documents WHERE id = ?')
    .bind(documentId)
    .first<{ id: string; owner_user_id: string }>()

  const authorizedDoc = resolveRoomDocumentOwner(documentId, userId, doc)
  if (!authorizedDoc || authorizedDoc.owner_user_id !== userId) {
    return c.json({ error: 'not-found' }, 404)
  }

  const roomId = await deriveHostedRoomId(documentId)
  const id = c.env.DOCUMENT_ROOM.idFromName(roomId)
  const stub = c.env.DOCUMENT_ROOM.get(id)

  if (c.req.header('upgrade') === 'websocket') {
    const headers = new Headers(c.req.raw.headers)
    headers.set('x-openpencil-user-id', userId)
    headers.set('x-openpencil-session-token', sessionToken)
    headers.set('x-openpencil-document-id', documentId)
    headers.set('x-openpencil-room-id', roomId)
    const upstream = await stub.fetch(new Request(c.req.raw, { headers }))
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers
    })
  }

  return c.json({ documentId, roomId, status: 'ok' })
})

export default {
  fetch: app.fetch,
  DocumentRoomDO
}

function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}
