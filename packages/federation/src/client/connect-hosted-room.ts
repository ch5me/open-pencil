/**
 * Hosted room WebSocket lifecycle helper. This is the part a second-cohort
 * sub-app uses to actually push Yjs/awareness updates over the wire.
 *
 * The helper is intentionally framework-agnostic: it takes a `ydoc` and
 * an `awareness` and wires up the same `update` / `awareness` listeners
 * the rest of OpenPencil uses, so any library that already speaks Yjs +
 * y-protocols/awareness can drop in.
 *
 * @module client/connect-hosted-room
 */

import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'

import { decodeBase64, encodeBase64 } from '../wire/base64'
import { parseWireMessage } from '../wire/protocol'
import type { HostedRoomWireMessageType, HostedRoomWireStats } from '../types/wire'
import type { HostedRoomConnection } from './room-client'
import { RoomError } from '../errors'

export type ConnectHostedRoomOptions = {
  ydoc: Y.Doc
  awareness: awarenessProtocol.Awareness
  connection: HostedRoomConnection
  onStateChange?: (state: HostedRoomConnectionState) => void
}

export type HostedRoomConnectionState =
  | { status: 'connecting' }
  | { status: 'connected' }
  | { status: 'reconnecting' }
  | { status: 'disconnected' }
  | { status: 'error'; message: string }

export type ConnectHostedRoomResult = {
  leave: () => void
  send: (type: HostedRoomWireMessageType, data: Uint8Array) => void
  stats: () => HostedRoomWireStats
}

/**
 * Open a hosted room WebSocket and wire it to a Yjs document + awareness
 * instance. Returns a handle with `leave` and `send` for the caller to use.
 *
 * Throws {@link RoomError} if the WebSocket cannot be opened at all. Once
 * connected, transient disconnects are handled internally and reported via
 * `onStateChange`.
 */
export function connectHostedRoom(options: ConnectHostedRoomOptions): ConnectHostedRoomResult {
  const { ydoc, awareness, connection, onStateChange } = options
  const stats: HostedRoomWireStats = {
    opened: 0,
    messagesSent: 0,
    messagesReceived: 0,
    syncStep1Sent: 0,
    syncReplySent: 0,
    yjsUpdateSent: 0,
    awarenessSent: 0,
    awarenessReceived: 0
  }

  let socket: WebSocket | null = null
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const emit = (state: HostedRoomConnectionState) => onStateChange?.(state)

  const send = (type: HostedRoomWireMessageType, data: Uint8Array) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    const payload = { type, data: encodeBase64(data) }
    stats.messagesSent += 1
    if (type === 'sync-step1') stats.syncStep1Sent += 1
    if (type === 'sync-reply') stats.syncReplySent += 1
    if (type === 'yjs-update') stats.yjsUpdateSent += 1
    if (type === 'awareness') stats.awarenessSent += 1
    socket.send(JSON.stringify(payload))
  }

  const handleMessage = (event: MessageEvent<string>) => {
    const wire = parseWireMessage(event.data)
    if (!wire) return
    stats.messagesReceived += 1
    const data = decodeBase64(wire.data)
    if (wire.type === 'awareness') {
      stats.awarenessReceived += 1
      awarenessProtocol.applyAwarenessUpdate(awareness, data, null)
      return
    }
    Y.applyUpdate(ydoc, data, 'remote')
  }

  const openSocket = () => {
    if (disposed) return
    emit({ status: 'connecting' })
    socket = new WebSocket(connection.url, connection.protocols)

    socket.addEventListener('open', () => {
      stats.opened += 1
      emit({ status: 'connected' })
      send('sync-step1', Y.encodeStateVector(ydoc))
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID])
      send('awareness', awarenessUpdate)
    })

    socket.addEventListener('message', handleMessage)

    socket.addEventListener('close', () => {
      if (disposed) {
        emit({ status: 'disconnected' })
        return
      }
      emit({ status: 'reconnecting' })
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        openSocket()
      }, 700)
    })

    socket.addEventListener('error', () => {
      emit({ status: 'error', message: 'Hosted collaboration connection failed.' })
    })
  }

  const ydocHandler = (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return
    send('yjs-update', update)
  }
  ydoc.on('update', ydocHandler)

  const awarenessHandler = (changes: { added: number[]; updated: number[]; removed: number[] }) => {
    const changedClients = [...changes.added, ...changes.updated, ...changes.removed]
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
    send('awareness', update)
  }
  awareness.on('update', awarenessHandler)

  try {
    openSocket()
  } catch {
    throw new RoomError('connection-failed', 'Could not open the hosted room WebSocket.')
  }

  return {
    leave: () => {
      disposed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      ydoc.off('update', ydocHandler)
      awareness.off('update', awarenessHandler)
      socket?.removeEventListener('message', handleMessage)
      socket?.close()
      emit({ status: 'disconnected' })
    },
    send,
    stats: () => ({ ...stats })
  }
}
