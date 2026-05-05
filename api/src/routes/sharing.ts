import { Hono } from 'hono'
import type { Env } from '../env'

export function createSharingRouter() {
  const router = new Hono<{ Bindings: Env }>()

  router.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  })

  router.post('/links', async (c) => {
    const body = await c.req.json<{ documentId: string; role?: string }>()
    const token = Array.from(new Uint8Array(32), (b) => b.toString(16).padStart(2, '0')).join('')
    const id = crypto.randomUUID()
    await c.env.DB.prepare(`
      INSERT INTO share_links (id, documentId, token, role, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, body.documentId, token, body.role ?? 'viewer', Date.now()).run()
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
    await c.env.DB.prepare(`DELETE FROM share_links WHERE token = ?`)
      .bind(c.req.param('token')).run()
    return c.json({ ok: true })
  })

  router.post('/members', async (c) => {
    const body = await c.req.json<{ documentId: string; userId: string; role: string }>()
    const id = crypto.randomUUID()
    await c.env.DB.prepare(`
      INSERT INTO document_members (id, documentId, userId, role, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, body.documentId, body.userId, body.role, Date.now(), Date.now()).run()
    return c.json({ id })
  })

  router.get('/documents/:documentId/members', async (c) => {
    const { results } = await c.env.DB.prepare(`
      SELECT dm.*, u.email, u.name FROM document_members dm
      JOIN users u ON u.id = dm.userId
      WHERE dm.documentId = ? AND dm._deleted = 0
    `).bind(c.req.param('documentId')).all()
    return c.json({ members: results })
  })

  router.patch('/members/:id', async (c) => {
    const body = await c.req.json<{ role: string }>()
    await c.env.DB.prepare(`
      UPDATE document_members SET role = ?, updatedAt = ? WHERE id = ?
    `).bind(body.role, Date.now(), c.req.param('id')).run()
    return c.json({ ok: true })
  })

  router.delete('/members/:id', async (c) => {
    await c.env.DB.prepare(`
      UPDATE document_members SET _deleted = 1, updatedAt = ? WHERE id = ?
    `).bind(Date.now(), c.req.param('id')).run()
    return c.json({ ok: true })
  })

  return router
}
