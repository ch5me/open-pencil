import type { Ref } from 'vue'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as awarenessProtocol from 'y-protocols/awareness'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { randomIndex } from '@open-pencil/core/random'

import { connectCollabRoom, type CollabRoomConnection } from '@/app/collab/room'
import type { CollabState } from '@/app/collab/types'
import { bindCollabGraphEvents, registerYjsObservers } from '@/app/collab/yjs-sync'
import type { EditorStore } from '@/app/editor/active-store'
import { PEER_COLORS } from '@/constants'

export type CollabRuntime = {
  ydoc: Y.Doc | null
  awareness: awarenessProtocol.Awareness | null
  ynodes: Y.Map<Y.Map<unknown>> | null
  yimages: Y.Map<Uint8Array> | null
  room: CollabRoomConnection['room'] | null
  persistence: IndexeddbPersistence | null
  connectedStore: EditorStore | null
  suppressGraphSync: boolean
  suppressYjsEvents: boolean
  unbindGraphEvents: (() => void) | null
  stopZoomWatch: (() => void) | null
}

type CollabEventCallbacks = {
  updatePeersList: () => void
  tickFollow: () => void
  broadcastAwareness: () => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  syncNodeToYjs: (nodeId: string) => void
  setConnectionError: (message: string | null) => void
}

type ConnectCollabSessionOptions = CollabEventCallbacks & {
  connection: ConnectOptions
  runtime: CollabRuntime
  state: Ref<CollabState>
  store: EditorStore
  disconnect: () => void
}

type ConnectOptions =
  | { mode: 'local-p2p'; roomId: string }
  | { mode: 'hosted-do'; documentId: string }

type CollabConnectionActionsOptions = CollabEventCallbacks & {
  runtime: CollabRuntime
  state: Ref<CollabState>
  getStore: () => EditorStore
  resetFollow: () => void
}

type CollabSessionResources = {
  store: EditorStore
  room: CollabRoomConnection['room'] | null
  awareness: awarenessProtocol.Awareness | null
  persistence: IndexeddbPersistence | null
  ydoc: Y.Doc | null
  unbindGraphEvents: (() => void) | null
  stopZoomWatch: (() => void) | null
  resetFollow: () => void
}

export function createCollabRuntime(): CollabRuntime {
  return {
    ydoc: null,
    awareness: null,
    ynodes: null,
    yimages: null,
    room: null,
    persistence: null,
    connectedStore: null,
    suppressGraphSync: false,
    suppressYjsEvents: false,
    unbindGraphEvents: null,
    stopZoomWatch: null
  }
}

export function createInitialCollabState(localName: string): CollabState {
  return {
    connected: false,
    reconnecting: false,
    mode: null,
    roomId: null,
    documentId: null,
    sharePath: null,
    peers: [],
    degraded: false,
    missingAssetIds: [],
    lastError: null,
    localName,
    localColor: PEER_COLORS[randomIndex(PEER_COLORS.length)]
  }
}

export function createCollabConnectionActions({
  runtime,
  state,
  getStore,
  updatePeersList,
  tickFollow,
  broadcastAwareness,
  applyYjsToGraph,
  syncNodeToYjs,
  setConnectionError,
  resetFollow
}: CollabConnectionActionsOptions) {
  function connect(options: ConnectOptions) {
    connectCollabSession({
      connection: options,
      runtime,
      state,
      store: getStore(),
      disconnect,
      updatePeersList,
      tickFollow,
      broadcastAwareness,
      applyYjsToGraph,
      syncNodeToYjs,
      setConnectionError
    })
  }

  function disconnect() {
    const store = runtime.connectedStore ?? getStore()
    disposeCollabSessionResources({
      store,
      room: runtime.room,
      awareness: runtime.awareness,
      persistence: runtime.persistence,
      ydoc: runtime.ydoc,
      unbindGraphEvents: runtime.unbindGraphEvents,
      stopZoomWatch: runtime.stopZoomWatch,
      resetFollow
    })
    resetCollabRuntime(runtime)
    resetCollabConnectionState(state)
  }

  return { connect, disconnect }
}

export function watchAwarenessZoom(store: EditorStore, getAwareness: () => Awareness | null) {
  return store.onEditorEvent('viewport:changed', (viewport) => {
    const awareness = getAwareness()
    if (!awareness) return
    const prev = awareness.getLocalState()?.cursor as
      | { x: number; y: number; pageId: string; zoom: number }
      | undefined
    if (prev) {
      awareness.setLocalStateField('cursor', { ...prev, zoom: viewport.zoom })
    }
  })
}

export function connectCollabSession({
  connection,
  runtime,
  state,
  store,
  disconnect,
  updatePeersList,
  tickFollow,
  broadcastAwareness,
  applyYjsToGraph,
  syncNodeToYjs,
  setConnectionError
}: ConnectCollabSessionOptions) {
  if (runtime.room) disconnect()

  runtime.connectedStore = store
  state.value.mode = connection.mode
  state.value.roomId = connection.mode === 'local-p2p' ? connection.roomId : null
  state.value.documentId = connection.mode === 'hosted-do' ? connection.documentId : null
  state.value.reconnecting = false
  state.value.degraded = false
  state.value.missingAssetIds = []
  state.value.lastError = null
  runtime.ydoc = new Y.Doc()
  runtime.awareness = new awarenessProtocol.Awareness(runtime.ydoc)
  runtime.ynodes = runtime.ydoc.getMap('nodes')
  runtime.yimages = runtime.ydoc.getMap('images')
  const persistenceKey =
    connection.mode === 'hosted-do'
      ? `op-room-hosted-${connection.documentId}`
      : `op-room-${connection.roomId}`
  runtime.persistence = new IndexeddbPersistence(persistenceKey, runtime.ydoc)

  runtime.awareness.on('change', () => {
    updatePeersList()
    tickFollow()
  })

  registerYjsObservers({
    store,
    ynodes: runtime.ynodes,
    yimages: runtime.yimages,
    getSuppressYjsEvents: () => runtime.suppressYjsEvents,
    setSuppressGraphSync: (value) => {
      runtime.suppressGraphSync = value
    },
    applyYjsToGraph
  })

  const sharedRoomOptions = {
    ydoc: runtime.ydoc,
    awareness: runtime.awareness,
    setConnected: () => {
      state.value.connected = true
      state.value.reconnecting = false
    },
    updatePeersList
  }

  const roomConnection =
    connection.mode === 'hosted-do'
      ? connectCollabRoom({
          ...sharedRoomOptions,
          ...connection,
          setReconnecting: (value) => {
            state.value.reconnecting = value
          },
          setConnectionError: (message) => {
            setConnectionError(message)
          },
          setHydrationState: ({ degraded, missingAssetIds }) => {
            state.value.degraded = degraded
            state.value.missingAssetIds = missingAssetIds
          }
        })
      : connectCollabRoom({
          ...sharedRoomOptions,
          ...connection
        })
  runtime.room = roomConnection.room
  state.value.roomId = roomConnection.roomId
  state.value.sharePath = roomConnection.sharePath
  state.value.connected = true
  broadcastAwareness()

  runtime.stopZoomWatch = watchAwarenessZoom(store, () => runtime.awareness)

  runtime.unbindGraphEvents = bindCollabGraphEvents({
    store,
    getYdoc: () => runtime.ydoc,
    getYnodes: () => runtime.ynodes,
    getSuppressGraphSync: () => runtime.suppressGraphSync,
    setSuppressYjsEvents: (value) => {
      runtime.suppressYjsEvents = value
    },
    syncNodeToYjs
  })
}

export function resetCollabRuntime(runtime: CollabRuntime) {
  runtime.unbindGraphEvents = null
  runtime.stopZoomWatch = null
  runtime.room = null
  runtime.awareness = null
  runtime.persistence = null
  runtime.ydoc = null
  runtime.ynodes = null
  runtime.yimages = null
  runtime.connectedStore = null
}

export function resetCollabConnectionState(state: Ref<CollabState>) {
  state.value.connected = false
  state.value.reconnecting = false
  state.value.mode = null
  state.value.roomId = null
  state.value.documentId = null
  state.value.sharePath = null
  state.value.peers = []
  state.value.degraded = false
  state.value.missingAssetIds = []
  state.value.lastError = null
}

export function disposeCollabSessionResources(resources: CollabSessionResources) {
  resources.unbindGraphEvents?.()
  resources.stopZoomWatch?.()
  resources.awareness?.setLocalState(null)
  void resources.room?.leave()
  resources.awareness?.destroy()
  if (resources.persistence) {
    void resources.persistence.destroy()
  }
  resources.ydoc?.destroy()
  resources.resetFollow()
  resources.store.state.remoteCursors = []
  resources.store.requestRender()
}
