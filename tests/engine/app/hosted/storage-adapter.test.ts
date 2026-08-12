import { afterEach, describe, expect, test } from 'bun:test'

import { HostedAPIError } from '@/app/hosted/http'
import { openHostedRouteDocument } from '@/app/hosted/navigation'
import {
  createHostedStorageAdapter,
  ELF_HOSTED_STORAGE_PROVIDER_ID
} from '@/app/hosted/storage/adapter'
import { resolveActiveStorageProviderID } from '@/app/integrations/storage/preferences'
import { storageProviderRegistry } from '@/app/integrations/storage/providers'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function requestURL(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

describe('ELF hosted storage adapter', () => {
  test('registers as a credential-free upstream storage provider', () => {
    const provider = storageProviderRegistry.get(ELF_HOSTED_STORAGE_PROVIDER_ID)
    expect(provider.preferenceFields).toEqual([])
    expect(provider.credentialFields).toEqual([])
  })

  test('selects ELF storage only for hosted-docs mode', () => {
    expect(resolveActiveStorageProviderID('s3-compatible', false)).toBe('s3-compatible')
    expect(resolveActiveStorageProviderID('s3-compatible', true)).toBe(
      ELF_HOSTED_STORAGE_PROVIDER_ID
    )
  })

  test('opens only hosted document deep links through the storage seam', async () => {
    const opened: string[] = []
    const openDocument = (documentId: string) => {
      opened.push(documentId)
      return Promise.resolve()
    }

    expect(
      await openHostedRouteDocument(
        { meta: { hostedOnly: true }, params: { documentId: 'doc-route' } },
        openDocument
      )
    ).toBe(true)
    expect(
      await openHostedRouteDocument(
        { meta: {}, params: { documentId: 'local-route' } },
        openDocument
      )
    ).toBe(false)
    expect(opened).toEqual(['doc-route'])
  })

  test('sends cookie and bearer auth while mapping list and snapshot responses', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const adapter = createHostedStorageAdapter(undefined, {
      apiOrigin: 'https://api.example.test',
      sessionToken: () => 'test-token',
      fetch: (async (url, init) => {
        const requestURLValue = requestURL(url)
        calls.push({ url: requestURLValue, init })
        if (requestURLValue.endsWith('/api/documents')) {
          return json({
            documents: [{ id: 'doc-1', title: 'Hosted doc', updatedAt: '2026-08-12T00:00:00Z' }]
          })
        }
        return json({
          document: { id: 'doc-1', title: 'Hosted doc', updatedAt: '2026-08-12T00:00:00Z' },
          snapshot: { bytesBase64: btoa(String.fromCharCode(1, 2, 3)) }
        })
      }) as typeof fetch
    })

    expect(await adapter.listDocuments()).toEqual([
      {
        id: 'doc-1',
        name: 'Hosted doc',
        updatedAt: '2026-08-12T00:00:00Z',
        metadataAuthoritative: true
      }
    ])
    expect(await adapter.getDocument('doc-1')).toEqual(new Uint8Array([1, 2, 3]))
    expect(calls[0]?.init?.credentials).toBe('include')
    expect(new Headers(calls[0]?.init?.headers).get('Authorization')).toBe('Bearer test-token')
  })

  test('updates existing documents and creates only after typed not-found', async () => {
    const methods: string[] = []
    let firstPut = true
    const adapter = createHostedStorageAdapter(undefined, {
      apiOrigin: 'https://api.example.test',
      fetch: (async (_url, init) => {
        methods.push(init?.method ?? 'GET')
        if (init?.method === 'PUT' && firstPut) {
          firstPut = false
          return json({ error: 'not-found', message: 'missing' }, 404)
        }
        return json(
          { documentId: 'doc-1', snapshotId: 'snap-1' },
          init?.method === 'POST' ? 201 : 200
        )
      }) as typeof fetch
    })

    await adapter.putDocument('doc-1', new Uint8Array([4, 5, 6]), {
      name: 'Created',
      updatedAt: '2026-08-12T00:00:00Z'
    })
    await adapter.putDocument('doc-1', new Uint8Array([7, 8, 9]), {
      name: 'Updated',
      updatedAt: '2026-08-12T00:00:01Z'
    })

    expect(methods).toEqual(['PUT', 'POST', 'PUT'])
  })

  test('preserves typed auth and missing-document failures', async () => {
    const adapter = createHostedStorageAdapter(undefined, {
      apiOrigin: 'https://api.example.test',
      fetch: (async () =>
        json({ error: 'unauthorized', message: 'Sign in required' }, 401)) as typeof fetch
    })

    await expect(adapter.listDocuments()).rejects.toEqual(
      new HostedAPIError(401, 'unauthorized', 'Sign in required')
    )
  })
})
