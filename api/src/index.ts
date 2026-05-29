import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { D1Database, R2Bucket, DurableObjectNamespace } from '@cloudflare/workers-types'
import { DocumentRoomDO } from './documents/room'
export { DocumentRoomDO }

export interface Env {
  DB: D1Database
  DOCUMENTS: R2Bucket
  ASSETS: R2Bucket
  DOCUMENT_ROOM: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Env }>()

app.use(cors({
  origin: ['https://pencil.ch5.me', 'https://app.openpencil.dev'],
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
      health: '/health'
    }
  })
})

// Document room DO access — returns a room stub ID for a given document
app.get('/api/documents/:documentId/room', async (c) => {
  const documentId = c.req.param('documentId')
  const roomId = `room_${documentId}`
  const id = c.env.DOCUMENT_ROOM.idFromName(roomId)
  const stub = c.env.DOCUMENT_ROOM.get(id)

  // TODO: wire proper Yjs sync handshake once auth session contract is implemented
  const _roomResponse = await stub.fetch(c.req.raw)
  return c.json({ documentId, roomId, status: 'ok' })
})

export default {
  fetch: app.fetch,
  DocumentRoomDO
}
