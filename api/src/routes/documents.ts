import { Hono } from 'hono'
import type { Env } from '../env'

export function createDocumentsRouter() {
  const router = new Hono<{ Bindings: Env }>()

  router.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  })

  router.post('/', async (c) => {
    const body = await c.req.json<{ title?: string }>()
    const id = crypto.randomUUID()
    const now = Date.now()
    await c.env.DB.prepare(`
      INSERT INTO documents (id, ownerId, title, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, 'system', body.title ?? 'Untitled', now, now).run()
    return c.json({ id, title: body.title ?? 'Untitled' })
  })

  router.get('/', async (c) => {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM documents WHERE ownerId = 'system' AND _deleted = 0 ORDER BY updatedAt DESC LIMIT 50
    `).all()
    return c.json({ documents: results })
  })

  router.get('/:id', async (c) => {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM documents WHERE id = ? AND _deleted = 0
    `).bind(c.req.param('id')).all()
    if (!results.length) return c.json({ error: 'Not found' }, 404)
    return c.json({ document: results[0] })
  })

  router.patch('/:id', async (c) => {
    const body = await c.req.json<{ title?: string; description?: string }>()
    const now = Date.now()
    await c.env.DB.prepare(`
      UPDATE documents SET title = COALESCE(?, title), description = COALESCE(?, description), updatedAt = ? WHERE id = ?
    `).bind(body.title, body.description, now, c.req.param('id')).run()
    return c.json({ ok: true })
  })

  router.delete('/:id', async (c) => {
    const now = Date.now()
    await c.env.DB.prepare(`
      UPDATE documents SET _deleted = 1, updatedAt = ? WHERE id = ?
    `).bind(now, c.req.param('id')).run()
    return c.json({ ok: true })
  })

  router.post('/:id/snapshot', async (c) => {
    const docId = c.req.param('id')
    const body = await c.req.json<{ data: string }>()
    const snapshotKey = `snapshots/${docId}/${Date.now()}.json`
    await c.env.DOCUMENTS.put(snapshotKey, body.data)
    const size = new TextEncoder().encode(body.data).length
    const snapshotId = crypto.randomUUID()
    await c.env.DB.prepare(`
      INSERT INTO document_snapshots (id, documentId, snapshotKey, size, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).bind(snapshotId, docId, snapshotKey, size, Date.now()).run()
    await c.env.DB.prepare(`
      UPDATE documents SET latestSnapshotKey = ?, updatedAt = ? WHERE id = ?
    `).bind(snapshotKey, Date.now(), docId).run()
    return c.json({ snapshotKey, snapshotId })
  })

  router.get('/:id/snapshot/latest', async (c) => {
    const { results } = await c.env.DB.prepare(`
      SELECT latestSnapshotKey FROM documents WHERE id = ?
    `).bind(c.req.param('id')).all()
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
