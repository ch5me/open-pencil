/**
 * Wire-protocol envelope used over the hosted room WebSocket.
 *
 * A second-cohort sub-app sends and receives JSON messages of the form
 * `{ type, data }` where `data` is a base64-encoded binary Yjs/awareness
 * update. Unknown `type` values are tolerated by both ends and must not
 * throw — that is how the protocol stays forward-compatible.
 *
 * @module wire/protocol
 */

import type { HostedRoomWireMessage, HostedRoomWireMessageType } from '../types/wire'

const KNOWN_TYPES: ReadonlySet<HostedRoomWireMessageType> = new Set<HostedRoomWireMessageType>([
  'yjs-update',
  'awareness',
  'sync-step1',
  'sync-reply',
  'room-state'
])

export function isHostedRoomWireMessageType(value: string): value is HostedRoomWireMessageType {
  return KNOWN_TYPES.has(value as HostedRoomWireMessageType)
}

export function parseWireMessage(payload: string): HostedRoomWireMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as { type?: unknown; data?: unknown }
  if (typeof obj.type !== 'string' || typeof obj.data !== 'string') return null
  if (!isHostedRoomWireMessageType(obj.type)) return null
  return { type: obj.type, data: obj.data }
}

export function buildSubprotocols(token: string | null | undefined): string[] {
  const out: string[] = []
  if (token) {
    const subprotocol = 'openpencil-room.v1'
    out.push(subprotocol, `bearer.${token}`)
  } else {
    out.push('openpencil-room.v1')
  }
  return out
}
