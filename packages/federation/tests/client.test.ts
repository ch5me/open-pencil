import { describe, expect, it } from 'bun:test'

import { createFederationClient } from '#federation/client/create-federation-client'
import { HostedApiError, SessionError } from '#federation/errors'

type CapturedCall = {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

function makeFetchSpy(responses: Array<{ status: number; body: unknown }>) {
  const calls: CapturedCall[] = []
  let index = 0
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input as URL).toString()
    const headers: Record<string, string> = {}
    if (init.headers instanceof Headers) {
      for (const [key, value] of init.headers.entries()) {
        headers[key] = value
      }
    } else if (init.headers) {
      Object.assign(headers, init.headers)
    }
    calls.push({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init.body === 'string' ? init.body : null
    })
    const next = responses[index++] ?? { status: 200, body: {} }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' }
    })
  }
  return { fetchImpl, calls }
}

describe('FederationClient.session', () => {
  it('maps an authenticated /api/session response to the discriminated outcome', async () => {
    const { fetchImpl, calls } = makeFetchSpy([{ status: 200, body: { user: { id: 'elf_42' }, mode: 'authenticated' } }])
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => 'tok_1', fetchImpl })
    const outcome = await client.session.resolve()
    expect(outcome).toEqual({ type: 'authenticated', userId: 'elf_42', token: 'tok_1' })
    expect(calls[0]?.headers['authorization']).toBe('Bearer tok_1')
    expect(calls[0]?.headers['x-federation-surface']).toMatch(/^@open-pencil\/federation@/)
  })

  it('maps an unauthenticated response to the unauthenticated outcome', async () => {
    const { fetchImpl } = makeFetchSpy([{ status: 200, body: { user: null, mode: 'unauthenticated' } }])
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => null, fetchImpl })
    expect(await client.session.resolve()).toEqual({ type: 'unauthenticated' })
  })

  it('maps a 401 to SessionError with invalid-token', async () => {
    const { fetchImpl } = makeFetchSpy([{ status: 401, body: { error: 'invalid-token', message: 'expired' } }])
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => 'tok', fetchImpl })
    expect(client.session.resolve()).rejects.toBeInstanceOf(SessionError)
  })

  it('maps a network failure to a HostedApiError with status 0', async () => {
    const failingFetch: typeof fetch = async () => {
      throw new Error('ECONNRESET')
    }
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => null, fetchImpl: failingFetch })
    try {
      await client.session.resolve()
      expect.unreachable('should throw')
    } catch (error) {
      expect(error).toBeInstanceOf(HostedApiError)
      expect((error as HostedApiError).status).toBe(0)
    }
  })
})

describe('FederationClient.documents', () => {
  it('list() hits GET /api/documents with the limit query', async () => {
    const { fetchImpl, calls } = makeFetchSpy([
      { status: 200, body: { documents: [{ id: 'doc_1', title: 't', sourceFormat: 'fig', currentSnapshotId: 's_1', updatedAt: '2026-06-10T00:00:00.000Z' }] } }
    ])
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => null, fetchImpl })
    const rows = await client.documents.list({ limit: 5 })
    expect(rows).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.test/api/documents?limit=5')
    expect(calls[0]?.method).toBe('GET')
  })

  it('save() PUTs a base64-encoded snapshot', async () => {
    const { fetchImpl, calls } = makeFetchSpy([
      { status: 200, body: { documentId: 'doc_1', snapshotId: 'snap_2' } }
    ])
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => null, fetchImpl })
    const result = await client.documents.save('doc_1', new Uint8Array([1, 2, 3, 4]), 'manual-save')
    expect(result).toEqual({ documentId: 'doc_1', latestSnapshotId: 'snap_2', sourceFormat: 'fig' })
    const body = JSON.parse(calls[0]?.body ?? '{}')
    expect(body.reason).toBe('manual-save')
    expect(typeof body.snapshotBytesBase64).toBe('string')
    expect(body.snapshotBytesBase64.length).toBeGreaterThan(0)
  })

  it('saveAs() POSTs a new document and returns its descriptor', async () => {
    const { fetchImpl, calls } = makeFetchSpy([
      { status: 201, body: { documentId: 'doc_new', snapshotId: 'snap_new' } }
    ])
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => null, fetchImpl })
    const result = await client.documents.saveAs(new Uint8Array([0xff, 0xfe]), { title: 'Spec' })
    expect(result.documentId).toBe('doc_new')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://api.test/api/documents')
    const body = JSON.parse(calls[0]?.body ?? '{}')
    expect(body.title).toBe('Spec')
  })

  it('delete() DELETEs the document', async () => {
    const { fetchImpl, calls } = makeFetchSpy([{ status: 200, body: { documentId: 'doc_1', deleted: true } }])
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => null, fetchImpl })
    const result = await client.documents.delete('doc_1')
    expect(result).toEqual({ documentId: 'doc_1', deleted: true })
    expect(calls[0]?.method).toBe('DELETE')
  })

  it('open() decodes base64 snapshot bytes and assets', async () => {
    const { fetchImpl } = makeFetchSpy([
      {
        status: 200,
        body: {
          document: { id: 'doc_1', ownerUserId: 'u_1', title: 't', sourceFormat: 'fig', currentSnapshotId: 's_1', currentSnapshotStorageKey: 'k', lifecycleState: 'active', createdAt: '', updatedAt: '' },
          snapshot: { id: 's_1', bytesBase64: btoa(String.fromCharCode(1, 2, 3)) },
          assets: [{ id: 'a_1', status: 'ready', bytesBase64: btoa(String.fromCharCode(9, 8, 7)) }],
          hydration: { degraded: false, missingAssetIds: [], message: null }
        }
      }
    ])
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => null, fetchImpl })
    const result = await client.documents.open('doc_1')
    expect(Array.from(result.snapshotBytes)).toEqual([1, 2, 3])
    expect(result.assets[0]?.status).toBe('ready')
    expect(Array.from(result.assets[0]?.bytes ?? [])).toEqual([9, 8, 7])
  })
})

describe('FederationClient.assets', () => {
  it('write() POSTs base64-encoded bytes to /assets', async () => {
    const { fetchImpl, calls } = makeFetchSpy([{ status: 201, body: { assetId: 'a_1', storageKey: 'k', byteLength: 3 } }])
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => null, fetchImpl })
    const result = await client.assets.write({
      documentId: 'doc_1',
      assetId: 'a_1',
      snapshotId: 's_1',
      kind: 'image',
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png'
    })
    expect(result.assetId).toBe('a_1')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://api.test/api/documents/doc_1/assets')
  })

  it('delete() DELETEs the asset by id', async () => {
    const { fetchImpl, calls } = makeFetchSpy([{ status: 200, body: { assetId: 'a_1', deleted: true } }])
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => null, fetchImpl })
    const result = await client.assets.delete('doc_1', 'a_1')
    expect(result).toEqual({ assetId: 'a_1', deleted: true })
    expect(calls[0]?.method).toBe('DELETE')
  })
})

describe('FederationClient.rooms', () => {
  it('resolveConnection() returns wss:// URL + subprotocols when origin is https', async () => {
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => 'tok' })
    const connection = await client.rooms.resolveConnection('doc_42')
    expect(connection.url).toBe('wss://api.test/api/documents/doc_42/room')
    expect(connection.protocols).toEqual(['openpencil-room.v1', 'bearer.tok'])
    expect(connection.roomId).toBe('doc_42')
  })

  it('resolveConnection() returns ws:// URL for http origins and no bearer when no token', async () => {
    const client = createFederationClient({ apiOrigin: 'http://127.0.0.1:8787', getToken: () => null })
    const connection = await client.rooms.resolveConnection('doc_42')
    expect(connection.url).toBe('ws://127.0.0.1:8787/api/documents/doc_42/room')
    expect(connection.protocols).toEqual(['openpencil-room.v1'])
  })

  it('loadSnapshot() decodes the base64 snapshot and asset bytes', async () => {
    const { fetchImpl } = makeFetchSpy([
      {
        status: 200,
        body: {
          document: { id: 'doc_1', title: 't', sourceFormat: 'fig', currentSnapshotId: 's_1', updatedAt: '' },
          snapshot: { id: 's_1', bytesBase64: btoa(String.fromCharCode(7, 7, 7)) },
          assets: [{ id: 'a_1', status: 'missing', bytesBase64: null }],
          hydration: { degraded: true, missingAssetIds: ['a_1'], message: 'degraded' }
        }
      }
    ])
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => null, fetchImpl })
    const result = await client.rooms.loadSnapshot('doc_1')
    expect(Array.from(result.snapshot.bytes)).toEqual([7, 7, 7])
    expect(result.hydration.degraded).toBe(true)
    expect(result.assets[0]?.status).toBe('missing')
    expect(result.assets[0]?.bytes).toBeNull()
  })
})

describe('FederationClient.surface', () => {
  it('exposes the package name and version for self-description', () => {
    const client = createFederationClient({ apiOrigin: 'https://api.test', getToken: () => null })
    expect(client.surface.name).toBe('@open-pencil/federation')
    expect(client.surface.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
