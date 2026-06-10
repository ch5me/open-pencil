import type { HostedSnapshotPayload, HostedRoomWireStats } from '../types/wire'

/**
 * Public room client. Owns the HTTP bootstrap half of the
 * `/api/documents/:id/room` route. The WebSocket half is provided by
 * {@link connectHostedRoom} (see `./connect-hosted-room.ts`).
 *
 * @module client/room-client
 */
export interface RoomClient {
  /**
   * Returns the metadata needed to join a hosted room: the
   * `room.id` derivation input, the snapshot bytes to hydrate, and any
   * assets the document depends on. The returned shape is the same
   * JSON the API serves, with binary fields decoded into `Uint8Array`.
   */
  loadSnapshot(documentId: string): Promise<LoadedHostedSnapshot>

  /**
   * Returns a WebSocket URL + subprotocol list a sub-app can hand to
   * `new WebSocket(...)`. The {@link connectHostedRoom} helper does this
   * for you.
   */
  resolveConnection(documentId: string): Promise<HostedRoomConnection>
}

export type LoadedHostedSnapshot = Omit<HostedSnapshotPayload, 'snapshot' | 'assets'> & {
  snapshot: { id: string; bytes: Uint8Array }
  assets: Array<{ id: string; status: 'ready' | 'missing'; bytes: Uint8Array | null }>
}

export type HostedRoomConnection = {
  /** Absolute `wss://` or `ws://` URL to pass to `new WebSocket(url, protocols)`. */
  url: string
  /** Subprotocols to pass as the second argument to `new WebSocket`. */
  protocols: string[]
  /** The opaque room id the host derived from the document id. */
  roomId: string
}

/** Stats counters returned by {@link connectHostedRoom} (read-only). */
export type HostedRoomStats = HostedRoomWireStats
