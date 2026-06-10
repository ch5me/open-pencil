/**
 * Public wire-protocol types for hosted collab rooms.
 *
 * A second-cohort sub-app that wants to join a hosted OpenPencil document
 * room must speak this protocol over a WebSocket. The protocol is a thin
 * base64-encoded Yjs + awareness sync layer.
 *
 * The WebSocket subprotocol is fixed at `openpencil-room.v1` (see
 * OPENPENCIL_ROOM_WS_SUBPROTOCOL). Sub-apps that use {@link connectHostedRoom}
 * (from `./client/room-client.ts`) get this for free.
 *
 * Compatibility rules:
 * - The discriminator `type` is the only stable field.
 * - New `type` values may be added in a MINOR version. Sub-apps must
 *   ignore unknown types and not throw.
 * - Removing a `type` is a MAJOR version change.
 *
 * @module types/wire
 */

export const OPENPENCIL_ROOM_WS_SUBPROTOCOL = 'openpencil-room.v1' as const

/** Subprotocol token used inside `Sec-WebSocket-Protocol` for bearer creds. */
export const OPENPENCIL_ROOM_BEARER_PREFIX = 'bearer.' as const

/** All wire message types. Sub-apps must handle each explicitly. */
export type HostedRoomWireMessageType =
  | 'yjs-update'
  | 'awareness'
  | 'sync-step1'
  | 'sync-reply'
  | 'room-state'

/** A single wire message exchanged with a hosted DocumentRoomDO. */
export type HostedRoomWireMessage = {
  type: HostedRoomWireMessageType
  data: string
}

/** Wire stat counters a sub-app may collect for observability. */
export type HostedRoomWireStats = {
  opened: number
  messagesSent: number
  messagesReceived: number
  syncStep1Sent: number
  syncReplySent: number
  yjsUpdateSent: number
  awarenessSent: number
  awarenessReceived: number
}

/**
 * Snapshot payload returned by GET /api/documents/:id/snapshot.
 * Used by the client to hydrate a Yjs document before joining the room.
 */
export type HostedSnapshotPayload = {
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
  assets: Array<{
    id: string
    status: 'ready' | 'missing'
    bytesBase64: string | null
  }>
  hydration: {
    degraded: boolean
    missingAssetIds: string[]
    message: string | null
  }
}
