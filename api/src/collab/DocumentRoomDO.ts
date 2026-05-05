import type { Env } from '../env'

export class DocumentRoomDO {
  private state: DurableObjectState
  private env: Env
  private sessions: Map<string, WebSocket> = new Map()
  private ydoc: Map<string, Uint8Array> = new Map()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      const webSocketPair = new WebSocketPair()
      const { 0: clientWebSocket, 1: serverWebSocket } = webSocketPair
      const sessionId = crypto.randomUUID()

      this.state.acceptWebSocket(serverWebSocket)
      this.sessions.set(sessionId, serverWebSocket)

      serverWebSocket.addEventListener('close', () => {
        this.sessions.delete(sessionId)
      })

      return new Response(null, { status: 101, webSocket: clientWebSocket })
    }

    if (url.pathname === '/state') {
      const currentState = this.ydoc.get('main') ?? new Uint8Array()
      return new Response(currentState, {
        headers: { 'content-type': 'application/octet-stream' },
      })
    }

    return new Response('Not found', { status: 404 })
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (typeof message === 'string') return
    const data = new Uint8Array(message)
    this.ydoc.set('main', data)
    this.scheduleFlush()
    this.broadcast(message, ws)
  }

  private broadcast(message: ArrayBuffer | string, exclude?: WebSocket): void {
    const data = typeof message === 'string' ? message : Array.from(new Uint8Array(message))
    for (const [, session] of this.sessions) {
      if (session !== exclude && session.readyState === WebSocket.OPEN) {
        session.send(data)
      }
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => this.flushToR2(), 5000)
  }

  private async flushToR2(): Promise<void> {
    const state = this.ydoc.get('main')
    if (!state) return
    const key = `ydoc/${this.state.id.name}.bin`
    await this.env.DOCUMENTS.put(key, state)
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    for (const [id, socket] of this.sessions) {
      if (socket === ws) {
        this.sessions.delete(id)
        break
      }
    }
    this.scheduleFlush()
  }
}