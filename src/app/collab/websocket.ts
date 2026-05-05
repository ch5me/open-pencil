import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'

type WsCollabOptions = {
  wsUrl: string
  ydoc: Y.Doc
  awareness: awarenessProtocol.Awareness
  setConnected: () => void
  updatePeersList: () => void
}

export type WsCollabConnection = {
  ws: WebSocket
  send: (data: Uint8Array) => void
  close: () => void
}

export function connectCollabWebSocket({
  wsUrl,
  ydoc,
  awareness,
  setConnected,
  updatePeersList
}: WsCollabOptions): WsCollabConnection | null {
  let ws: WebSocket
  try {
    ws = new WebSocket(wsUrl)
  } catch {
    return null
  }

  let isReady = false
  const pending: Uint8Array[] = []

  const send = (data: Uint8Array) => {
    if (isReady && ws.readyState === WebSocket.OPEN) {
      ws.send(data)
      return
    }
    pending.push(data)
  }

  ws.binaryType = 'arraybuffer'

  ws.addEventListener('open', () => {
    isReady = true
    setConnected()

    for (const buf of pending) {
      ws.send(buf)
    }
    pending.length = 0
  })

  ws.addEventListener('message', (event) => {
    const buf = new Uint8Array(event.data)
    Y.applyUpdate(ydoc, buf, 'remote')
  })

  ws.addEventListener('error', () => {
    updatePeersList()
  })

  ydoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return
    send(update)
  })

  awareness.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changedClients = [...added, ...updated, ...removed]
      const encoded = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      send(encoded)
    }
  )

  updatePeersList()

  const close = () => {
    ws.close()
  }

  return { ws, send, close }
}
