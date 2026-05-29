import { joinRoom as joinTrysteroRoom } from 'trystero/mqtt'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'

import { getHostedConfig } from '@/app/hosted/flags'
import { DEV_STUB_ELF_TOKEN } from '@/app/hosted/token'
import { TRYSTERO_APP_ID } from '@/constants'

type SharedRoomOptions = {
  ydoc: Y.Doc
  awareness: awarenessProtocol.Awareness
  setConnected: () => void
  updatePeersList: () => void
}

type LocalRoomOptions = SharedRoomOptions & {
  mode: 'local-p2p'
  roomId: string
}

type HostedRoomOptions = SharedRoomOptions & {
  mode: 'hosted-do'
  documentId: string
  setReconnecting: (value: boolean) => void
  setConnectionError: (message: string | null) => void
  setHydrationState: (payload: { degraded: boolean; missingAssetIds: string[] }) => void
}

export type CollabRoomOptions = LocalRoomOptions | HostedRoomOptions

export type CollabRoomHandle = {
  leave: () => void
}

export type CollabRoomConnection = {
  room: CollabRoomHandle
  roomId: string
  sharePath: string
}

type WireMessageType = 'yjs-update' | 'awareness' | 'sync-step1' | 'sync-reply' | 'room-state'

type WireMessage = {
  type: WireMessageType
  data: string
}

type HostedSnapshotPayload = {
  document: {
    id: string
    title: string
    sourceFormat: string
    currentSnapshotId: string
    updatedAt: string
  }
  snapshot: {
    id: string
    bytesBase64: string
  }
  assets: {
    id: string
    status: 'ready' | 'missing'
    bytesBase64: string | null
  }[]
  hydration: {
    degraded: boolean
    missingAssetIds: string[]
    message: string | null
  }
}

const hostedWireStats = {
  opened: 0,
  messagesSent: 0,
  messagesReceived: 0,
  syncStep1Sent: 0,
  syncReplySent: 0,
  yjsUpdateSent: 0,
  awarenessSent: 0,
  awarenessReceived: 0,
}

type TestWindow = Window & {
  openPencil?: {
    test?: {
      hostedAuthToken?: string
    }
  }
}

export function connectCollabRoom(options: CollabRoomOptions): CollabRoomConnection {
  return options.mode === 'hosted-do' ? connectHostedRoom(options) : connectLocalRoom(options)
}

function connectLocalRoom({
  roomId,
  ydoc,
  awareness,
  setConnected,
  updatePeersList
}: LocalRoomOptions): CollabRoomConnection {
  const room = joinTrysteroRoom(
    {
      appId: TRYSTERO_APP_ID,
      rtcConfig: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ]
      }
    },
    roomId
  )

  const [sendUpdate, getUpdate] = room.makeAction<Uint8Array>('yjs-update')
  const [sendAwareness, getAwareness] = room.makeAction<Uint8Array>('awareness')
  const [sendSyncStep1, getSyncStep1] = room.makeAction<Uint8Array>('sync-step1')
  const [sendSyncReply, getSyncReply] = room.makeAction<Uint8Array>('sync-reply')

  getUpdate((data) => {
    Y.applyUpdate(ydoc, new Uint8Array(data), 'remote')
  })

  getAwareness((data) => {
    awarenessProtocol.applyAwarenessUpdate(awareness, new Uint8Array(data), null)
  })

  getSyncStep1((data, peerId) => {
    const update = Y.encodeStateAsUpdate(ydoc, new Uint8Array(data))
    void sendSyncReply(update, peerId)
  })

  getSyncReply((data) => {
    Y.applyUpdate(ydoc, new Uint8Array(data), 'remote')
  })

  const ydocHandler = (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return
    void sendUpdate(update)
  }
  ydoc.on('update', ydocHandler)

  const awarenessHandler = ({
    added,
    updated,
    removed
  }: {
    added: number[]
    updated: number[]
    removed: number[]
  }) => {
    const changedClients = [...added, ...updated, ...removed]
    const encodedUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
    void sendAwareness(encodedUpdate)
  }
  awareness.on('update', awarenessHandler)

  room.onPeerJoin((peerId) => {
    setConnected()
    void sendSyncStep1(Y.encodeStateVector(ydoc), peerId)
    void sendAwareness(
      awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]),
      peerId
    )
  })

  room.onPeerLeave(() => {
    const remoteClients = [...awareness.getStates().keys()].filter(
      (id) => id !== awareness.clientID
    )
    awarenessProtocol.removeAwarenessStates(awareness, remoteClients, 'peer-left')
    updatePeersList()
  })

  return {
    room: {
      leave: () => {
        ydoc.off('update', ydocHandler)
        awareness.off('update', awarenessHandler)
        void room.leave()
      }
    },
    roomId,
    sharePath: `/share/${roomId}`
  }
}

function connectHostedRoom({
  documentId,
  ydoc,
  awareness,
  setConnected,
  updatePeersList,
  setReconnecting,
  setConnectionError,
  setHydrationState
}: HostedRoomOptions): CollabRoomConnection {
  const apiOrigin = getHostedConfig().apiOrigin
  if (!apiOrigin) {
    throw new Error('Hosted collaboration requires VITE_API_ORIGIN.')
  }

  const url = new URL(`${apiOrigin}/api/documents/${documentId}/room`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  const token = (window as TestWindow).openPencil?.test?.hostedAuthToken ?? DEV_STUB_ELF_TOKEN
  const protocols = ['openpencil-room.v1']
  if (token) protocols.push(`bearer.${token}`)

  void loadHostedSnapshot({
    documentId,
    apiOrigin,
    token,
    ydoc,
    setConnectionError,
    setHydrationState
  })
  setReconnecting(true)
  setConnectionError(null)

  let socket: WebSocket | null = null
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const sendWireMessage = (type: WireMessageType, data: Uint8Array) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    const payload: WireMessage = { type, data: encodeBase64(data) }
    hostedWireStats.messagesSent += 1
    if (type === 'sync-step1') hostedWireStats.syncStep1Sent += 1
    if (type === 'sync-reply') hostedWireStats.syncReplySent += 1
    if (type === 'yjs-update') hostedWireStats.yjsUpdateSent += 1
    if (type === 'awareness') hostedWireStats.awarenessSent += 1
    socket.send(JSON.stringify(payload))
  }

  const handleMessage = (event: MessageEvent<string>) => {
    const payload = JSON.parse(event.data) as WireMessage
    const data = decodeBase64(payload.data)
    hostedWireStats.messagesReceived += 1
    if (payload.type === 'room-state' || payload.type === 'yjs-update' || payload.type === 'sync-reply') {
      Y.applyUpdate(ydoc, data, 'remote')
      return
    }
    if (payload.type === 'awareness') {
      hostedWireStats.awarenessReceived += 1
      awarenessProtocol.applyAwarenessUpdate(awareness, data, null)
      return
    }
    sendWireMessage('sync-reply', Y.encodeStateAsUpdate(ydoc, data))
  }

  function connectSocket() {
    if (disposed) return
    setReconnecting(true)
    socket = new WebSocket(url.toString(), protocols)

    socket.addEventListener('open', () => {
      hostedWireStats.opened += 1
      setReconnecting(false)
      setConnectionError(null)
      setConnected()
      sendWireMessage('sync-step1', Y.encodeStateVector(ydoc))
      sendWireMessage(
        'awareness',
        awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID])
      )
    })
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', () => {
      const remoteClients = [...awareness.getStates().keys()].filter(
        (id) => id !== awareness.clientID
      )
      awarenessProtocol.removeAwarenessStates(awareness, remoteClients, 'peer-left')
      updatePeersList()
      if (disposed) {
        setReconnecting(false)
        return
      }
      setReconnecting(true)
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connectSocket()
      }, 700)
    })
    socket.addEventListener('error', () => {
      setConnectionError('Hosted collaboration connection failed. Refresh the page to retry the room.')
    })
  }

  const ydocHandler = (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return
    sendWireMessage('yjs-update', update)
  }
  ydoc.on('update', ydocHandler)

  const awarenessHandler = ({
    added,
    updated,
    removed
  }: {
    added: number[]
    updated: number[]
    removed: number[]
  }) => {
    const changedClients = [...added, ...updated, ...removed]
    sendWireMessage('awareness', awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients))
  }
  awareness.on('update', awarenessHandler)

  connectSocket()

  return {
    room: {
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
      }
    },
    roomId: documentId,
    sharePath: `/hosted/${documentId}`
  }
}

async function loadHostedSnapshot(options: {
  documentId: string
  apiOrigin: string
  token: string
  ydoc: Y.Doc
  setConnectionError: (message: string | null) => void
  setHydrationState: (payload: { degraded: boolean; missingAssetIds: string[] }) => void
}) {
  try {
    const response = await fetch(`${options.apiOrigin}/api/documents/${options.documentId}/snapshot`, {
      credentials: 'include',
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : undefined
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as
        | { message?: string; reason?: string; error?: string }
        | null
      options.setHydrationState({ degraded: false, missingAssetIds: [] })
      options.setConnectionError(
        errorBody?.message ??
          (errorBody?.reason === 'invalid-token'
            ? 'Hosted session expired. Sign in again to reopen this room.'
            : 'Hosted room bootstrap failed. Refresh the page to retry.')
      )
      return
    }

    const payload = (await response.json()) as HostedSnapshotPayload
    Y.applyUpdate(options.ydoc, decodeBase64(payload.snapshot.bytesBase64), 'remote')

    for (const asset of payload.assets) {
      if (asset.status !== 'ready' || !asset.bytesBase64) continue
      const images = options.ydoc.getMap<Uint8Array>('images')
      images.set(asset.id, decodeBase64(asset.bytesBase64))
    }

    options.setHydrationState({
      degraded: payload.hydration.degraded,
      missingAssetIds: payload.hydration.missingAssetIds
    })

    if (payload.hydration.degraded) {
      options.setConnectionError(
        payload.hydration.message ??
          `Hosted document loaded without ${payload.hydration.missingAssetIds.length} asset(s). Re-upload missing assets to restore fidelity.`
      )
    } else {
      options.setConnectionError(null)
    }
  } catch {
    options.setHydrationState({ degraded: false, missingAssetIds: [] })
    options.setConnectionError('Hosted room bootstrap failed. Refresh the page to retry.')
  }
}

function encodeBase64(data: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < data.length; index += chunkSize) {
    const chunk = data.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function getHostedWireStats() {
  return { ...hostedWireStats }
}
