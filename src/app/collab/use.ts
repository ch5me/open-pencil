import { tryOnScopeDispose, useLocalStorage } from '@vueuse/core'
import { computed, ref } from 'vue'

import { setOpenPencilTestHooks } from '@/app/browser-bridge'
import { createFollowActions, generateRoomId } from '@/app/collab/awareness'
import { createLocalAwarenessActions } from '@/app/collab/local-awareness'
import { getHostedWireStats } from '@/app/collab/room'
import {
  createCollabConnectionActions,
  createCollabRuntime,
  createInitialCollabState
} from '@/app/collab/session'
import { DEFAULT_COLLAB_STATE, type CollabState, type RemotePeer } from '@/app/collab/types'
import { createYjsGraphSync } from '@/app/collab/yjs-sync'
import type { EditorStore } from '@/app/editor/active-store'

export { COLLAB_KEY, useCollabInjected } from '@/app/collab/context'
export { DEFAULT_COLLAB_STATE }
export type { CollabState, RemotePeer }

export function useCollab(storeOrGetter: EditorStore | (() => EditorStore)) {
  const getStore = () =>
    typeof storeOrGetter === 'function' ? (storeOrGetter as () => EditorStore)() : storeOrGetter
  const storedName = useLocalStorage('op-collab-name', '')
  const state = ref<CollabState>(createInitialCollabState(storedName.value))
  const runtime = createCollabRuntime()
  const remotePeers = computed(() => state.value.peers)
  const getActiveStore = () => runtime.connectedStore ?? getStore()

  const { followingPeer, followPeer, resetFollow, tickFollow } = createFollowActions(
    getActiveStore,
    () => runtime.awareness
  )
  const { broadcastAwareness, updateCursor, updateSelection, updatePeersList, setLocalName } =
    createLocalAwarenessActions({
      state,
      storedName,
      getStore: getActiveStore,
      getAwareness: () => runtime.awareness
    })

  const { syncNodeToYjs, syncAllNodesToYjs, applyYjsToGraph } = createYjsGraphSync({
    getStore: getActiveStore,
    getYdoc: () => runtime.ydoc,
    getYnodes: () => runtime.ynodes,
    getYimages: () => runtime.yimages,
    setSuppressYjsEvents: (value) => {
      runtime.suppressYjsEvents = value
    }
  })
  function setConnectionError(message: string | null) {
    state.value.lastError = message
  }

  const { connect, disconnect } = createCollabConnectionActions({
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
  })

  function shareCurrentDoc(): string {
    const roomId = generateRoomId()
    connect({ mode: 'local-p2p', roomId })
    syncAllNodesToYjs()
    return roomId
  }

  function connectLocalRoom(roomId: string) {
    connect({ mode: 'local-p2p', roomId })
  }

  function connectHostedDocument(documentId: string) {
    connect({ mode: 'hosted-do', documentId })
  }

  tryOnScopeDispose(disconnect)

  setOpenPencilTestHooks({
    getCollabSnapshot: () => {
      const store = getActiveStore()
      return {
        connected: state.value.connected,
        reconnecting: state.value.reconnecting,
        mode: state.value.mode,
        roomId: state.value.roomId,
        documentId: state.value.documentId,
        peerCount: state.value.peers.length,
        remoteCursorCount: store.state.remoteCursors.length,
        sharePath: state.value.sharePath,
        degraded: state.value.degraded,
        missingAssetIds: [...state.value.missingAssetIds],
        lastError: state.value.lastError,
      }
    },
    setCollabProofValue: (value: string) => {
      const store = getActiveStore()
      store.state.documentName = value
      store.requestRender()
    },
    getCollabProofValue: () => getActiveStore().state.documentName,
    setCollabYjsProofValue: (value: string) => {
      runtime.ydoc?.getMap('proof').set('value', value)
    },
    getCollabYjsProofValue: () => (runtime.ydoc?.getMap('proof').get('value') as string | undefined) ?? null,
    getHostedWireStats: () => getHostedWireStats(),
  })

  return {
    state,
    remotePeers,
    followingPeer,
    connect: connectLocalRoom,
    connectHostedDocument,
    disconnect,
    shareCurrentDoc,
    updateCursor,
    updateSelection,
    setLocalName,
    followPeer,
    tickFollow
  }
}
