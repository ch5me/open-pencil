import { Hono } from 'hono'
import type { Env } from '../env'

export function createCollabRouter() {
  const router = new Hono<{ Bindings: Env }>()

  router.get('/room/:documentId', async (c) => {
    const documentId = c.req.param('documentId')
    const id = c.env.DOCUMENT_ROOM.idFromName(documentId)
    const stub = c.env.DOCUMENT_ROOM.get(id)
    return c.json({ roomId: id.toString(), durableObject: stub.toString() })
  })

  return router
}
