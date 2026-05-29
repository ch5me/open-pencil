import { describe, expect, it } from 'bun:test'

import { deriveHostedRoomId } from './room-id'

describe('deriveHostedRoomId', () => {
  it('is deterministic and namespaced', async () => {
    const first = await deriveHostedRoomId('document_123')
    const second = await deriveHostedRoomId('document_123')
    const other = await deriveHostedRoomId('document_456')

    expect(first).toBe(second)
    expect(first).not.toBe(other)
    expect(first.startsWith('op_room_')).toBe(true)
    expect(first.length).toBe(40)
  })
})
