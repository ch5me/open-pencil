import * as Y from 'yjs'

import {
  appendPendingRoomUpdate,
  compactPersistedRoomState,
  createEmptyPersistedRoomState,
  shouldCompactPersistedRoomState,
  type PersistedRoomState
} from './room-persistence'

type WireMessageType = 'yjs-update' | 'awareness' | 'sync-step1' | 'sync-reply' | 'room-state'

type WireMessage = {
  type: WireMessageType
  data: string
}

const ROOM_STATE_KEY = 'room-state'

export class DocumentRoomDO implements DurableObject {
  private readonly state: DurableObjectState
  private readonly ydoc = new Y.Doc()
  private readonly peers = new Set<WebSocket>()
  private readonly peerUsers = new Map<WebSocket, string>()
  private readonly peerAwareness = new Map<WebSocket, string>()
  private roomState: PersistedRoomState = createEmptyPersistedRoomState()
  private roomStateReady: Promise<void>

  constructor(state: DurableObjectState) {
    this.state = state
    this.roomStateReady = this.loadRoomState()
  }

  async fetch(request: Request): Promise<Response> {
    await this.roomStateReady

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(JSON.stringify({ status: 'room-active', class: 'DocumentRoomDO' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const userId = request.headers.get('x-openpencil-user-id')
    if (!userId) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.state.acceptWebSocket(server)

    server.send(JSON.stringify({
      type: 'room-state',
      data: encodeBase64(Y.encodeStateAsUpdate(this.ydoc))
    } satisfies WireMessage))

    for (const payload of this.peerAwareness.values()) {
      server.send(payload)
    }

    this.peers.add(server)
    this.peerUsers.set(server, userId)
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': 'openpencil-room.v1' }
    })
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (!this.peers.has(socket)) return
    const payload = typeof message === 'string' ? message : new TextDecoder().decode(message)
    const wire = parseWireMessage(payload)
    const type = wire?.type ?? null

    if (wire && (wire.type === 'yjs-update' || wire.type === 'sync-reply' || wire.type === 'room-state')) {
      const update = decodeBase64(wire.data)
      Y.applyUpdate(this.ydoc, update, 'remote')
      void this.persistYjsUpdate(update)
    }

    if (type === 'awareness') {
      this.peerAwareness.set(socket, payload)
    }
    for (const peer of this.peers) {
      if (peer === socket) continue
      peer.send(payload)
    }
  }

  webSocketClose(socket: WebSocket) {
    this.peers.delete(socket)
    this.peerUsers.delete(socket)
    this.peerAwareness.delete(socket)
  }

  webSocketError(socket: WebSocket) {
    this.peers.delete(socket)
    this.peerUsers.delete(socket)
    this.peerAwareness.delete(socket)
  }

  private async loadRoomState() {
    const persisted = await this.state.storage.get<PersistedRoomState>(ROOM_STATE_KEY)
    this.roomState = persisted ?? createEmptyPersistedRoomState()
    if (this.roomState.snapshotBase64) {
      Y.applyUpdate(this.ydoc, decodeBase64(this.roomState.snapshotBase64), 'remote')
    }
    for (const updateBase64 of this.roomState.pendingUpdates) {
      Y.applyUpdate(this.ydoc, decodeBase64(updateBase64), 'remote')
    }
  }

  private async persistYjsUpdate(update: Uint8Array) {
    const nextState = appendPendingRoomUpdate(this.roomState, encodeBase64(update), update.byteLength)
    this.roomState = shouldCompactPersistedRoomState(nextState)
      ? compactPersistedRoomState(
          nextState,
          encodeBase64(Y.encodeStateAsUpdate(this.ydoc)),
          'threshold',
          new Date().toISOString()
        )
      : nextState
    await this.state.storage.put(ROOM_STATE_KEY, this.roomState)
  }
}

function parseWireMessage(payload: string): WireMessage | null {
  try {
    const parsed = JSON.parse(payload) as Partial<WireMessage>
    if (typeof parsed.type !== 'string' || typeof parsed.data !== 'string') return null
    return parsed as WireMessage
  } catch {
    return null
  }
}

function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
