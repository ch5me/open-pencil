import { joinRoom as joinTrysteroRoom } from 'trystero/mqtt'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'

import {
  createFederationClient,
  connectHostedRoom as connectFederationRoom,
  type FederationClient,
  type HostedRoomConnectionState,
  type ConnectHostedRoomResult
} from '@open-pencil/federation'

import { DEV_STUB_ELF_TOKEN } from '@/app/hosted/token'
import { getHostedConfig } from '@/app/hosted/flags'
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

let _federationClient: FederationClient | null = null

const hostedWireStats = {
  opened: 0,
  messagesSent: 0,
  messagesReceived: 0,
  syncStep1Sent: 0,
  syncReplySent: 0,
  yjsUpdateSent: 0,
  awarenessSent: 0,
  awarenessReceived: 0
}

function getFederationClient(): FederationClient {
  if (_federationClient) return _federationClient
  const apiOrigin = getHostedConfig().apiOrigin
  const token = (window as Window & { openPencil?: { test?: { hostedAuthToken?: string } } })
    .openPencil?.test?.hostedAuthToken ?? DEV_STUB_ELF_TOKEN
  _federationClient = createFederationClient({
    apiOrigin,
    getToken: () => token
  })
  return _federationClient
}

export function getHostedWireStats() {
  return { ...hostedWireStats }
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
  const client = getFederationClient()
  let connection: Awaited<ReturnType<FederationClient['rooms']['resolveConnection']>> | null = null
  let handle: ConnectHostedRoomResult | null = null

  const onStateChange = (state: HostedRoomConnectionState) => {
    if (state.status === 'connecting') setReconnecting(true)
    else if (state.status === 'connected') {
      setReconnecting(false)
      setConnectionError(null)
      setConnected()
    } else if (state.status === 'reconnecting') {
      setReconnecting(true)
    } else if (state.status === 'error') {
      setConnectionError(state.message)
    } else if (state.status === 'disconnected') {
      setReconnecting(false)
    }
  }

  void (async () => {
    try {
      connection = await client.rooms.resolveConnection(documentId)
      handle = connectFederationRoom({ ydoc, awareness, connection, onStateChange })
      const liveStats = handle.stats()
      hostedWireStats.opened = liveStats.opened
      hostedWireStats.messagesSent = liveStats.messagesSent
      hostedWireStats.messagesReceived = liveStats.messagesReceived
      hostedWireStats.syncStep1Sent = liveStats.syncStep1Sent
      hostedWireStats.syncReplySent = liveStats.syncReplySent
      hostedWireStats.yjsUpdateSent = liveStats.yjsUpdateSent
      hostedWireStats.awarenessSent = liveStats.awarenessSent
      hostedWireStats.awarenessReceived = liveStats.awarenessReceived
      await hydrateSnapshot(client, documentId, ydoc, setConnectionError, setHydrationState)
    } catch (error) {
      setReconnecting(false)
      setConnectionError(
        error instanceof Error
          ? `Hosted room bootstrap failed: ${error.message}`
          : 'Hosted room bootstrap failed. Refresh the page to retry.'
      )
    }
  })()

  const awarenessHandler = () => updatePeersList()
  awareness.on('update', awarenessHandler)

  return {
    room: {
      leave: () => {
        awareness.off('update', awarenessHandler)
        handle?.leave()
      }
    },
    roomId: documentId,
    sharePath: `/hosted/${documentId}`
  }
}

async function hydrateSnapshot(
  client: FederationClient,
  documentId: string,
  ydoc: Y.Doc,
  setConnectionError: (message: string | null) => void,
  setHydrationState: (payload: { degraded: boolean; missingAssetIds: string[] }) => void
): Promise<void> {
  try {
    const snapshot = await client.rooms.loadSnapshot(documentId)
    Y.applyUpdate(ydoc, snapshot.snapshot.bytes, 'remote')
    const images = ydoc.getMap<Uint8Array>('images')
    for (const asset of snapshot.assets) {
      if (asset.status !== 'ready' || !asset.bytes) continue
      images.set(asset.id, asset.bytes)
    }
    setHydrationState({
      degraded: snapshot.hydration.degraded,
      missingAssetIds: snapshot.hydration.missingAssetIds
    })
    if (snapshot.hydration.degraded) {
      setConnectionError(
        snapshot.hydration.message ??
          `Hosted document loaded without ${snapshot.hydration.missingAssetIds.length} asset(s). Re-upload missing assets to restore fidelity.`
      )
    } else {
      setConnectionError(null)
    }
  } catch {
    setHydrationState({ degraded: false, missingAssetIds: [] })
    setConnectionError('Hosted room bootstrap failed. Refresh the page to retry.')
  }
}
