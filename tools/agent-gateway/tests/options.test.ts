import { describe, expect, test } from 'bun:test'

import { AGENT_OPTIONS_SCHEMA } from '@open-pencil/agent-contracts'

import { AgentCatalogError, createAgentCatalogSource } from '../src/options'

const catalog = {
  schema: AGENT_OPTIONS_SCHEMA,
  options: [
    {
      optionId: 'option-balanced',
      label: 'Balanced',
      group: 'Recommended',
      description: 'Balances speed and quality.',
      capabilities: ['tools'],
      efforts: ['low', 'high'],
      selected: true,
      default: true
    }
  ]
}

function source(body: unknown, responseInit?: ResponseInit) {
  return createAgentCatalogSource(
    {
      AGENT_NATIVE_CATALOG_URL: 'http://127.0.0.1/catalog',
      AGENT_NATIVE_CATALOG_TOKEN: 'source-token',
      AGENT_NATIVE_CATALOG_MAX_AGE_SECONDS: '60'
    },
    (async (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer source-token')
      expect(new Headers(init?.headers).get('x-openpencil-principal')).toBe('principal-1')
      return Response.json(body, responseInit)
    }) as typeof fetch,
    () => Date.parse('2026-08-14T12:00:00.000Z')
  )
}

describe('Agent Native catalog source', () => {
  test('allows HTTP only for loopback localhost aliases', async () => {
    const localAlias = createAgentCatalogSource(
      {
        AGENT_NATIVE_CATALOG_URL: 'http://dispatch.agent-native.localhost/catalog',
        AGENT_NATIVE_CATALOG_TOKEN: 'source-token'
      },
      (async (_input, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer source-token')
        return Response.json({
          catalog,
          issuedAt: '2026-08-14T11:59:30.000Z',
          expiresAt: '2026-08-14T12:00:30.000Z'
        })
      }) as typeof fetch,
      () => Date.parse('2026-08-14T12:00:00.000Z')
    )

    await expect(localAlias('principal-1')).resolves.toEqual(catalog)
  })

  test('loads and projects a fresh provider-neutral catalog', async () => {
    await expect(
      source({
        catalog,
        issuedAt: '2026-08-14T11:59:30.000Z',
        expiresAt: '2026-08-14T12:00:30.000Z'
      })('principal-1')
    ).resolves.toEqual(catalog)
  })

  test('accepts Agent Native numeric millisecond timestamps', async () => {
    await expect(
      source({
        catalog,
        issuedAt: Date.parse('2026-08-14T11:59:30.000Z'),
        expiresAt: Date.parse('2026-08-14T12:00:30.000Z')
      })('principal-1')
    ).resolves.toEqual(catalog)
  })

  test('fails closed for missing configuration and unavailable responses', async () => {
    expect(() => createAgentCatalogSource({})).toThrow(AgentCatalogError)
    expect(() =>
      createAgentCatalogSource({ AGENT_NATIVE_CATALOG_URL: 'https://catalog.example/options' })
    ).toThrow(AgentCatalogError)
    await expect(
      source(
        {
          catalog,
          issuedAt: '2026-08-14T11:59:30.000Z',
          expiresAt: '2026-08-14T12:00:30.000Z'
        },
        { status: 503 }
      )('principal-1')
    ).rejects.toMatchObject({
      code: 'options-unavailable'
    })
  })

  test('rejects stale, malformed, and recursively infrastructure-bearing sources', async () => {
    for (const body of [
      catalog,
      {
        catalog,
        issuedAt: '2026-08-14T11:58:59.000Z',
        expiresAt: '2026-08-14T12:00:30.000Z'
      },
      {
        catalog,
        issuedAt: '2099-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:05:00.000Z'
      },
      { ...catalog, options: 'invalid' },
      {
        catalog,
        issuedAt: '2026-08-14T11:59:30.000Z',
        expiresAt: '2026-08-14T12:00:30.000Z',
        metadata: { provider: 'private' }
      },
      {
        catalog: {
          ...catalog,
          options: [
            {
              ...catalog.options[0],
              description: 'Use https://provider.example with an API key.'
            }
          ]
        },
        issuedAt: '2026-08-14T11:59:30.000Z',
        expiresAt: '2026-08-14T12:00:30.000Z'
      }
    ]) {
      await expect(source(body)('principal-1')).rejects.toMatchObject({
        code: 'catalog-invalid'
      })
    }
  })

  test('rejects oversized and deeply nested sources before projection', async () => {
    const oversized = {
      catalog,
      issuedAt: '2026-08-14T11:59:30.000Z',
      expiresAt: '2026-08-14T12:00:30.000Z',
      padding: 'x'.repeat(300_000)
    }
    await expect(source(oversized)('principal-1')).rejects.toMatchObject({
      code: 'catalog-invalid'
    })

    let nested: unknown = catalog
    for (let index = 0; index < 20; index += 1) nested = [nested]
    await expect(
      source({
        catalog: nested,
        issuedAt: '2026-08-14T11:59:30.000Z',
        expiresAt: '2026-08-14T12:00:30.000Z'
      })('principal-1')
    ).rejects.toMatchObject({ code: 'catalog-invalid' })
  })
})
