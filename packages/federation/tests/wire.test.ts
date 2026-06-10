import { describe, expect, it } from 'bun:test'

import { decodeBase64, encodeBase64 } from '#federation/wire/base64'
import { buildSubprotocols, isHostedRoomWireMessageType, parseWireMessage } from '#federation/wire/protocol'

describe('wire/base64', () => {
  it('round-trips empty buffers', () => {
    const empty = new Uint8Array(0)
    expect(decodeBase64(encodeBase64(empty))).toEqual(empty)
  })

  it('round-trips a known payload byte-for-byte', () => {
    const original = new Uint8Array([0, 1, 2, 3, 4, 5, 250, 251, 252, 253, 254, 255])
    expect(decodeBase64(encodeBase64(original))).toEqual(original)
  })

  it('handles large buffers via chunked encoding', () => {
    const size = 0x10000
    const original = new Uint8Array(size)
    for (let i = 0; i < size; i++) original[i] = (i * 7) & 0xff
    expect(decodeBase64(encodeBase64(original))).toEqual(original)
  })

  it('matches the btoa() reference for ASCII payloads', () => {
    const text = 'hello federation surface'
    const bytes = new TextEncoder().encode(text)
    const expected = btoa(text)
    expect(encodeBase64(bytes)).toBe(expected)
  })
})

describe('wire/protocol', () => {
  it('recognises every known wire type', () => {
    for (const type of ['yjs-update', 'awareness', 'sync-step1', 'sync-reply', 'room-state']) {
      expect(isHostedRoomWireMessageType(type)).toBe(true)
    }
  })

  it('rejects unknown wire types', () => {
    expect(isHostedRoomWireMessageType('not-a-type')).toBe(false)
    expect(isHostedRoomWireMessageType('')).toBe(false)
  })

  it('parses well-formed messages and ignores malformed ones', () => {
    const ok = parseWireMessage(JSON.stringify({ type: 'yjs-update', data: 'AAAA' }))
    expect(ok).toEqual({ type: 'yjs-update', data: 'AAAA' })

    expect(parseWireMessage('not json')).toBeNull()
    expect(parseWireMessage(JSON.stringify({ type: 1, data: 'A' }))).toBeNull()
    expect(parseWireMessage(JSON.stringify({ type: 'made-up', data: 'A' }))).toBeNull()
    expect(parseWireMessage(JSON.stringify({ data: 'A' }))).toBeNull()
  })

  it('builds subprotocols with bearer when a token is present', () => {
    expect(buildSubprotocols('abc123')).toEqual(['openpencil-room.v1', 'bearer.abc123'])
  })

  it('builds subprotocols without bearer when no token is set', () => {
    expect(buildSubprotocols(null)).toEqual(['openpencil-room.v1'])
    expect(buildSubprotocols(undefined)).toEqual(['openpencil-room.v1'])
    expect(buildSubprotocols('')).toEqual(['openpencil-room.v1'])
  })
})
