import type { Color } from '@open-pencil/core/types'

export interface RemotePeer {
  clientId: number
  name: string
  color: Color
  cursor?: { x: number; y: number; pageId: string }
  selection?: string[]
}

export interface CollabState {
  connected: boolean
  reconnecting: boolean
  mode: 'local-p2p' | 'hosted-do' | null
  roomId: string | null
  documentId: string | null
  sharePath: string | null
  peers: RemotePeer[]
  degraded: boolean
  missingAssetIds: string[]
  lastError: string | null
  localName: string
  localColor: Color
}

export const DEFAULT_COLLAB_STATE: CollabState = {
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
  localName: '',
  localColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 }
}
