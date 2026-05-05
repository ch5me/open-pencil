import { Hono } from 'hono'
import type { Context } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import type { Env } from '../env'
import { createBetterAuth } from '../auth/better-auth'

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

export function createSharingRouter() {
  const router = new Hono<{ Bindings: Env }>()

  async function ensureAuthorized(c: Context<{ Bindings: Env }>) {
    const authHeader = c.req.header('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const userId = await getBearerUserId(c.env.DB, authHeader)
      if (userId) return userId
    }

    const auth = createBetterAuth(c.env.DB, {
      RESEND_API_KEY: c.env.RESEND_API_KEY,
      PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
      BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
      BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
    })
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    return session?.session?.userId ?? null
  }

  router.post('/links', async (c) => {
    const userId = await ensureAuthorized(c)
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    c.set('authUserId', userId)
    const body = await c.req.json<{ documentId: string; role?: string }>()
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    const id = crypto.randomUUID()
    await c.env.DB.prepare(`
      INSERT INTO share_links (id, documentId, token, role, createdBy, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, body.documentId, token, body.role ?? 'viewer', c.get('authUserId'), Date.now()).run()
    return c.json({ id, token })
  })

  router.get('/links/:token', async (c) => {
    const { results } = await c.env.DB.prepare(`
      SELECT sl.*, d.title, d.isPublic FROM share_links sl
      JOIN documents d ON d.id = sl.documentId
      WHERE sl.token = ?
    `).bind(c.req.param('token')).all()
    if (!results.length) return c.json({ error: 'Not found' }, 404)
    return c.json({ link: results[0] })
  })

  router.delete('/links/:token', async (c) => {
    const userId = await ensureAuthorized(c)
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    await c.env.DB.prepare(`DELETE FROM share_links WHERE token = ?`)
      .bind(c.req.param('token')).run()
    return c.json({ ok: true })
  })

  router.post('/members', async (c) => {
    const userId = await ensureAuthorized(c)
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const body = await c.req.json<{ documentId: string; userId: string; role: string }>()
    const id = crypto.randomUUID()
    await c.env.DB.prepare(`
      INSERT INTO document_members (id, documentId, userId, role, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, body.documentId, body.userId, body.role, Date.now(), Date.now()).run()
    return c.json({ id })
  })

  router.get('/documents/:documentId/members', async (c) => {
    const userId = await ensureAuthorized(c)
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const { results } = await c.env.DB.prepare(`
      SELECT dm.*, u.email, u.name FROM document_members dm
      JOIN users u ON u.id = dm.userId
      WHERE dm.documentId = ? AND dm._deleted = 0
    `).bind(c.req.param('documentId')).all()
    return c.json({ members: results })
  })

  router.patch('/members/:id', async (c) => {
    const userId = await ensureAuthorized(c)
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const body = await c.req.json<{ role: string }>()
    await c.env.DB.prepare(`
      UPDATE document_members SET role = ?, updatedAt = ? WHERE id = ?
    `).bind(body.role, Date.now(), c.req.param('id')).run()
    return c.json({ ok: true })
  })

  router.delete('/members/:id', async (c) => {
    const userId = await ensureAuthorized(c)
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    await c.env.DB.prepare(`
      UPDATE document_members SET _deleted = 1, updatedAt = ? WHERE id = ?
    `).bind(Date.now(), c.req.param('id')).run()
    return c.json({ ok: true })
  })

  return router
}
