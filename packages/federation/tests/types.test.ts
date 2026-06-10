import { describe, expect, it } from 'bun:test'

import { FEDERATION_SURFACE_NAME, FEDERATION_SURFACE_VERSION } from '#federation/version'
import {
  DocumentBackendOperationError,
  FederationError,
  HostedApiError,
  RoomError,
  SessionError,
  isFederationError
} from '#federation/errors'
import {
  type HostedDocumentDescriptor,
  type HostedDocumentSourceFormat,
  type HostedSnapshotReason,
  type HostedRoomWireMessageType,
  type SessionResolveOutcome,
  OPENPENCIL_ROOM_WS_SUBPROTOCOL
} from '#federation/types'

describe('version', () => {
  it('exposes a semver surface version and library name', () => {
    expect(FEDERATION_SURFACE_NAME).toBe('@open-pencil/federation')
    expect(FEDERATION_SURFACE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('errors', () => {
  it('preserves code, status, and details on HostedApiError', () => {
    const err = new HostedApiError(404, 'not-found', 'missing', { id: 'doc_1' })
    expect(err).toBeInstanceOf(FederationError)
    expect(err.code).toBe('not-found')
    expect(err.status).toBe(404)
    expect(err.details).toEqual({ id: 'doc_1' })
  })

  it('SessionError carries its code on the public surface', () => {
    const err = new SessionError('invalid-token', 'expired')
    expect(err.code).toBe('invalid-token')
    expect(err.message).toBe('expired')
  })

  it('RoomError carries its code on the public surface', () => {
    const err = new RoomError('connection-failed', 'no socket')
    expect(err.code).toBe('connection-failed')
  })

  it('DocumentBackendOperationError preserves mode + operation', () => {
    const err = new DocumentBackendOperationError('illegal-operation', 'nope', {
      backendId: 'hosted-document',
      mode: 'hosted-docs-single-user',
      operation: 'open'
    })
    expect(err.code).toBe('illegal-operation')
    expect(err.details).toEqual({ backendId: 'hosted-document', mode: 'hosted-docs-single-user', operation: 'open' })
  })

  it('isFederationError narrows correctly', () => {
    expect(isFederationError(new HostedApiError(500, 'x', 'y'))).toBe(true)
    expect(isFederationError(new Error('plain'))).toBe(false)
    expect(isFederationError('string')).toBe(false)
    expect(isFederationError(null)).toBe(false)
  })
})

describe('public types', () => {
  it('HostedDocumentSourceFormat is a tagged union', () => {
    const formats: HostedDocumentSourceFormat[] = ['fig', 'pen']
    expect(formats).toHaveLength(2)
  })

  it('HostedSnapshotReason is a tagged union', () => {
    const reasons: HostedSnapshotReason[] = ['initial-import', 'manual-save', 'autosave', 'duplicate']
    expect(reasons).toHaveLength(4)
  })

  it('HostedDocumentDescriptor is structurally compatible with descriptor consumers', () => {
    const desc: HostedDocumentDescriptor = {
      documentId: 'doc_abc',
      latestSnapshotId: 'snap_xyz',
      sourceFormat: 'fig'
    }
    expect(desc.documentId).toBe('doc_abc')
  })

  it('HostedRoomWireMessageType is a tagged union of the known protocol messages', () => {
    const types: HostedRoomWireMessageType[] = [
      'yjs-update',
      'awareness',
      'sync-step1',
      'sync-reply',
      'room-state'
    ]
    expect(types).toHaveLength(5)
  })

  it('SessionResolveOutcome discriminator covers all three branches', () => {
    const unauth: SessionResolveOutcome = { type: 'unauthenticated' }
    const authd: SessionResolveOutcome = { type: 'authenticated', userId: 'u_1', token: 't_1' }
    const conflict: SessionResolveOutcome = { type: 'unauthorized', reason: 'identity-conflict' }
    expect(unauth.type).toBe('unauthenticated')
    expect(authd.type).toBe('authenticated')
    expect(conflict.type).toBe('unauthorized')
  })

  it('exposes the WebSocket subprotocol constant', () => {
    expect(OPENPENCIL_ROOM_WS_SUBPROTOCOL).toBe('openpencil-room.v1')
  })
})
