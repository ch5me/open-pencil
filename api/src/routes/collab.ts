import { Hono } from 'hono'
import type { Env } from '../env'

export function createCollabRouter() {
  const router = new Hono<{ Bindings: Env }>()

  router.get('/room/:documentId', async (c) => {
    const documentId = c.req.param('documentId')
    const id = c.env.DOCUMENT_ROOM.idFromName(documentId)
    const wsProtocol = c.req.raw.headers.get('x-forwarded-proto') === 'http' ? 'ws' : 'wss'
    const host = c.req.raw.headers.get('host') ?? 'api.pencil.ch5.me'
    return c.json({
      documentId,
      wsUrl: `${wsProtocol}://${host}/api/collab/room/${documentId}/ws`,
    })
  })

  // WebSocket upgrade — proxy to DocumentRoomDO
  router.get('/room/:documentId/ws', async (c) => {
    const documentId = c.req.param('documentId')
    const id = c.env.DOCUMENT_ROOM.idFromName(documentId)
    const stub = c.env.DOCUMENT_ROOM.get(id)

    const upgrade = c.req.raw.headers.get('upgrade')?.toLowerCase()
    if (upgrade !== 'websocket') {
      return c.json({ error: 'websocket upgrade required' }, { status: 400 })
    }

    const pair = new WebSocketPair()
    const { 0: clientWebSocket, 1: serverWebSocket } = pair

    try {
      const response = await stub.fetch('https://do/ws', {
        headers: { upgrade: 'websocket' },
      })

      if (response.status === 101 && response.webSocket) {
        const remoteWs = response.webSocket
        remoteWs.accept()

        remoteWs.addEventListener('message', (event) => {
          try {
            serverWebSocket.send(event.data)
          } catch {
            // client disconnected
          }
        })

        remoteWs.addEventListener('close', () => {
          try {
            serverWebSocket.close()
          } catch {
            // already closed
          }
        })

        serverWebSocket.addEventListener('message', (event) => {
          try {
            remoteWs.send(event.data)
          } catch {
            // DO disconnected
          }
        })

        serverWebSocket.addEventListener('close', () => {
          try {
            remoteWs.close()
          } catch {
            // already closed
          }
        })

        serverWebSocket.accept()
        return new Response(null, { status: 101, webSocket: clientWebSocket })
      }
    } catch {
      // DO unavailable
    }

    return c.json({ error: 'failed to connect to document room' }, { status: 502 })
  })

  return router
}
