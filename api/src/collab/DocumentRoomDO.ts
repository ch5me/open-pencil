import type { Env } from '../env'

type ClientMetadata = {
  sessionId: string
  sentInitialState: boolean
}

export class DocumentRoomDO {
  private state: DurableObjectState
  private env: Env
  private sessions: Map<WebSocket, ClientMetadata> = new Map()
  private ydocUpdate: Uint8Array | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      const pair = new WebSocketPair()
      const { 0: client, 1: server } = pair
      const sessionId = crypto.randomUUID()

      this.state.acceptWebSocket(server)

      const metadata: ClientMetadata = { sessionId, sentInitialState: false }
      this.sessions.set(server, metadata)

      // Load persisted state on first connection, then broadcast to newcomer
      if (!this.initialized) {
        const r2Key = `ydoc/${this.state.id.name}.bin`
        try {
          const obj = await this.env.DOCUMENTS.get(r2Key)
          if (obj) {
            this.ydocUpdate = new Uint8Array(await obj.arrayBuffer())
          }
        } catch {
          // R2 unavailable — start with empty state
        }
        this.initialized = true
      }

      // Broadcast current state to the newly connected client
      if (this.ydocUpdate) {
        server.send(this.ydocUpdate)
        metadata.sentInitialState = true
      }

      return new Response(null, { status: 101, webSocket: client })
    }

    // HTTP endpoint — return room metadata
    if (url.pathname === '/info' || url.pathname === '/state') {
      const key = `ydoc/${this.state.id.name}.bin`
      try {
        const obj = await this.env.DOCUMENTS.get(key)
        if (obj) {
          const buf = new Uint8Array(await obj.arrayBuffer())
          return new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })
        }
      } catch {
        // R2 unavailable
      }
      return new Response(null, { headers: { 'content-type': 'application/octet-stream' } })
    }

    return new Response('Not found', { status: 404 })
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    this.handleMessage(ws, message)
  }

  webSocketClose(ws: WebSocket): void {
    this.sessions.delete(ws)
  }

  private handleMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    if (typeof data === 'string') return
    const buf = new Uint8Array(data)
    this.ydocUpdate = buf
    this.broadcast(buf, ws)
    this.scheduleFlush()
  }

  private broadcast(data: ArrayBuffer | string, exclude?: WebSocket): void {
    for (const [ws] of this.sessions) {
      if (ws === exclude) continue
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      } catch {
        // dead connection — runtime cleans up on next event
      }
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => this.flushToR2(), 2000)
  }

  private async flushToR2(): Promise<void> {
    if (!this.ydocUpdate) return
    const key = `ydoc/${this.state.id.name}.bin`
    try {
      await this.env.DOCUMENTS.put(key, this.ydocUpdate)
    } catch {
      // R2 write failed — state remains in memory
    }
    this.flushTimer = null
  }
}
