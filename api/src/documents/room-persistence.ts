export const ROOM_PENDING_UPDATE_COMPACTION_COUNT = 24
export const ROOM_PENDING_UPDATE_COMPACTION_BYTES = 128 * 1024

export type RoomCompactionReason = 'threshold' | 'room-idle' | 'manual-load'

export type PersistedRoomState = {
  snapshotBase64: string | null
  pendingUpdates: string[]
  pendingUpdateCount: number
  pendingUpdateBytes: number
  lastCompactedAt: string | null
  lastCompactionReason: RoomCompactionReason | null
}

export function createEmptyPersistedRoomState(): PersistedRoomState {
  return {
    snapshotBase64: null,
    pendingUpdates: [],
    pendingUpdateCount: 0,
    pendingUpdateBytes: 0,
    lastCompactedAt: null,
    lastCompactionReason: null
  }
}

export function appendPendingRoomUpdate(
  state: PersistedRoomState,
  updateBase64: string,
  updateBytes: number
): PersistedRoomState {
  return {
    ...state,
    pendingUpdates: [...state.pendingUpdates, updateBase64],
    pendingUpdateCount: state.pendingUpdateCount + 1,
    pendingUpdateBytes: state.pendingUpdateBytes + updateBytes
  }
}

export function shouldCompactPersistedRoomState(state: PersistedRoomState): boolean {
  return (
    state.pendingUpdateCount >= ROOM_PENDING_UPDATE_COMPACTION_COUNT ||
    state.pendingUpdateBytes >= ROOM_PENDING_UPDATE_COMPACTION_BYTES
  )
}

export function compactPersistedRoomState(
  _state: PersistedRoomState,
  snapshotBase64: string,
  reason: RoomCompactionReason,
  now: string
): PersistedRoomState {
  return {
    snapshotBase64,
    pendingUpdates: [],
    pendingUpdateCount: 0,
    pendingUpdateBytes: 0,
    lastCompactedAt: now,
    lastCompactionReason: reason
  }
}
