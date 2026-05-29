import { describe, expect, test } from 'bun:test'

import {
  ROOM_PENDING_UPDATE_COMPACTION_BYTES,
  ROOM_PENDING_UPDATE_COMPACTION_COUNT,
  appendPendingRoomUpdate,
  compactPersistedRoomState,
  createEmptyPersistedRoomState,
  shouldCompactPersistedRoomState
} from './room-persistence'

describe('room persistence helpers', () => {
  test('compacts after enough pending updates', () => {
    let state = createEmptyPersistedRoomState()
    for (let index = 0; index < ROOM_PENDING_UPDATE_COMPACTION_COUNT; index += 1) {
      state = appendPendingRoomUpdate(state, `u${index}`, 4)
    }
    expect(shouldCompactPersistedRoomState(state)).toBe(true)
  })

  test('compacts after enough pending bytes', () => {
    const state = appendPendingRoomUpdate(
      createEmptyPersistedRoomState(),
      'large-update',
      ROOM_PENDING_UPDATE_COMPACTION_BYTES
    )
    expect(shouldCompactPersistedRoomState(state)).toBe(true)
  })

  test('resets pending queue on compaction', () => {
    const compacted = compactPersistedRoomState(
      appendPendingRoomUpdate(createEmptyPersistedRoomState(), 'u1', 12),
      'snapshot-base64',
      'threshold',
      '2026-05-29T00:00:00.000Z'
    )
    expect(compacted).toEqual({
      snapshotBase64: 'snapshot-base64',
      pendingUpdates: [],
      pendingUpdateCount: 0,
      pendingUpdateBytes: 0,
      lastCompactedAt: '2026-05-29T00:00:00.000Z',
      lastCompactionReason: 'threshold'
    })
  })
})
