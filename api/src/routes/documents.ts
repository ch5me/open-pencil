import { Hono } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import type { Env } from '../env'
import { createBetterAuth } from '../auth/better-auth'

export function nullableText(value?: string): string | null {
  return value ?? null
}

async function getBearerUserId(db: D1Database, authHeader: string): Promise<string | null> {
  const token = authHeader.slice('Bearer '.length)
  const row = await db.prepare('SELECT userId FROM sessions WHERE token = ? AND expiresAt > ?')
    .bind(token, Date.now())
    .first<{ userId: string }>()
  return row?.userId ?? null
}

declare module 'hono' {
  interface ContextVariableMap {
    authUserId: string
  }
}

export function createDocumentsRouter() {
  const router = new Hono<{ Bindings: Env }>()

  router.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const userId = await getBearerUserId(c.env.DB, authHeader)
      if (!userId) return c.json({ error: 'Unauthorized' }, 401)
      c.set('authUserId', userId)
      await next()
      return
    }

    const auth = createBetterAuth(c.env.DB, {
      RESEND_API_KEY: c.env.RESEND_API_KEY,
      PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
      BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
      BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
    })
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    const userId = session?.session?.userId
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    c.set('authUserId', userId)
    await next()
  })

  router.post('/', async (c) => {
    const body = await c.req.json<{ title?: string }>()
    const id = crypto.randomUUID()
    const now = Date.now()
    const ownerId = c.get('authUserId')
    await c.env.DB.prepare(`
      INSERT INTO documents (id, ownerId, title, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, ownerId, body.title ?? 'Untitled', now, now).run()
    return c.json({ id, title: body.title ?? 'Untitled' })
  })

  router.get('/', async (c) => {
    const ownerId = c.get('authUserId')
    const limitValue = Number(c.req.query('limit') ?? '50')
    const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(50, Math.trunc(limitValue))) : 50
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM documents WHERE ownerId = ? AND _deleted = 0 ORDER BY updatedAt DESC LIMIT ?
    `).bind(ownerId, limit).all()
    return c.json({ documents: results })
  })

  router.get('/:id', async (c) => {
    const ownerId = c.get('authUserId')
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM documents WHERE id = ? AND ownerId = ? AND _deleted = 0
    `).bind(c.req.param('id'), ownerId).all()
    if (!results.length) return c.json({ error: 'Not found' }, 404)
    return c.json({ document: results[0] })
  })

  router.patch('/:id', async (c) => {
    const body = await c.req.json<{ title?: string; description?: string }>()
    const now = Date.now()
    const ownerId = c.get('authUserId')
    await c.env.DB.prepare(`
      UPDATE documents SET title = COALESCE(?, title), description = COALESCE(?, description), updatedAt = ? WHERE id = ? AND ownerId = ?
    `).bind(nullableText(body.title), nullableText(body.description), now, c.req.param('id'), ownerId).run()
    return c.json({ ok: true })
  })

  router.delete('/:id', async (c) => {
    const now = Date.now()
    const ownerId = c.get('authUserId')
    await c.env.DB.prepare(`
      UPDATE documents SET _deleted = 1, updatedAt = ? WHERE id = ? AND ownerId = ?
    `).bind(now, c.req.param('id'), ownerId).run()
    return c.json({ ok: true })
  })

  router.post('/:id/snapshot', async (c) => {
    const docId = c.req.param('id')
    const ownerId = c.get('authUserId')
    const body = await c.req.json<{ data: string; title?: string }>()
    const { results } = await c.env.DB.prepare(`
      SELECT id FROM documents WHERE id = ? AND ownerId = ? AND _deleted = 0
    `).bind(docId, ownerId).all()
    if (!results.length) return c.json({ error: 'Not found' }, 404)
    const snapshotKey = `snapshots/${docId}/${Date.now()}.json`
    await c.env.DOCUMENTS.put(snapshotKey, body.data)
    const size = new TextEncoder().encode(body.data).length
    const snapshotId = crypto.randomUUID()
    await c.env.DB.prepare(`
      INSERT INTO document_snapshots (id, documentId, snapshotKey, size, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).bind(snapshotId, docId, snapshotKey, size, Date.now()).run()
    await c.env.DB.prepare(`
      UPDATE documents
      SET latestSnapshotKey = ?, title = COALESCE(?, title), updatedAt = ?
      WHERE id = ? AND ownerId = ?
    `).bind(snapshotKey, nullableText(body.title), Date.now(), docId, ownerId).run()
    return c.json({ snapshotKey, snapshotId })
  })

  router.get('/:id/snapshot/latest', async (c) => {
    const ownerId = c.get('authUserId')
    const { results } = await c.env.DB.prepare(`
      SELECT latestSnapshotKey FROM documents WHERE id = ? AND ownerId = ? AND _deleted = 0
    `).bind(c.req.param('id'), ownerId).all()
    if (!results.length || !results[0].latestSnapshotKey) {
      return c.json({ error: 'No snapshot' }, 404)
    }
    const object = await c.env.DOCUMENTS.get(results[0].latestSnapshotKey as string)
    if (!object) return c.json({ error: 'Snapshot not found' }, 404)
    const data = await object.text()
    return c.json({ data })
  })

  return router
}
