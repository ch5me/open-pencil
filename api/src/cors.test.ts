import { describe, expect, test } from 'bun:test'

import { resolveAllowedOrigin } from './cors'
import { app } from './index'

describe('resolveAllowedOrigin', () => {
  test('accepts deployed and fixed-port development origins', () => {
    expect(resolveAllowedOrigin('https://design.elf.dance', 'openpencil-api.elf.dance')).toBe(
      'https://design.elf.dance'
    )
    expect(
      resolveAllowedOrigin('https://staging.design.elf.dance', 'staging-openpencil-api.elf.dance')
    ).toBe('https://staging.design.elf.dance')
    expect(resolveAllowedOrigin('http://127.0.0.1:1420', 'openpencil-api.elf.dance')).toBe(
      'http://127.0.0.1:1420'
    )
  })

  test('accepts same-tree OpenPencil app origins served through the CH5 development proxy', () => {
    expect(
      resolveAllowedOrigin(
        'http://app.open-pencil.localhost:7300',
        'api.open-pencil.localhost:7300'
      )
    ).toBe('http://app.open-pencil.localhost:7300')
    expect(
      resolveAllowedOrigin(
        'http://app.openpencil-local-bootstrap.localhost:7300',
        'api.openpencil-local-bootstrap.localhost:7300'
      )
    ).toBe('http://app.openpencil-local-bootstrap.localhost:7300')
    expect(
      resolveAllowedOrigin(
        'http://app.open-pencil.ch5-laptop-m5.dev.ch5.me:7300',
        'api.open-pencil.ch5-laptop-m5.dev.ch5.me:7300'
      )
    ).toBe('http://app.open-pencil.ch5-laptop-m5.dev.ch5.me:7300')
  })

  test('rejects cross-tree, cross-box, deployed API, port, and suffix mismatches', () => {
    expect(
      resolveAllowedOrigin('http://app.other-tree.localhost:7300', 'api.open-pencil.localhost:7300')
    ).toBeUndefined()
    expect(
      resolveAllowedOrigin(
        'http://app.open-pencil.other-box.dev.ch5.me:7300',
        'api.open-pencil.ch5-laptop-m5.dev.ch5.me:7300'
      )
    ).toBeUndefined()
    expect(
      resolveAllowedOrigin('http://app.open-pencil.localhost:7300', 'api.openpencil.dev')
    ).toBeUndefined()
    expect(
      resolveAllowedOrigin(
        'http://app.open-pencil.localhost:7301',
        'api.open-pencil.localhost:7300'
      )
    ).toBeUndefined()
    expect(
      resolveAllowedOrigin(
        'https://app.open-pencil.localhost:7300',
        'api.open-pencil.localhost:7300'
      )
    ).toBeUndefined()
    expect(
      resolveAllowedOrigin(
        'http://app.open-pencil.localhost.evil.test:7300',
        'api.open-pencil.localhost:7300'
      )
    ).toBeUndefined()
  })

  test('rejects non-canonical origins and host authorities', () => {
    const canonicalOrigin = 'http://app.open-pencil.localhost:7300'
    const canonicalHost = 'api.open-pencil.localhost:7300'

    for (const origin of [
      'http://evil@app.open-pencil.localhost:7300',
      `${canonicalOrigin}/`,
      `${canonicalOrigin}/path`,
      `${canonicalOrigin}?query=1`,
      `${canonicalOrigin}#fragment`,
      'HTTP://app.open-pencil.localhost:7300'
    ]) {
      expect(resolveAllowedOrigin(origin, canonicalHost)).toBeUndefined()
    }

    for (const host of [
      `evil@${canonicalHost}`,
      `${canonicalHost}/path`,
      `${canonicalHost}?query=1`,
      `${canonicalHost}#fragment`,
      'API.open-pencil.localhost:7300',
      'api.open-pencil.localhost:7300:evil'
    ]) {
      expect(resolveAllowedOrigin(canonicalOrigin, host)).toBeUndefined()
    }
  })
})

interface PreflightCase {
  name: string
  requestOrigin: string
  origin: string
  allowed: boolean
}

const PREFLIGHT_CASES: PreflightCase[] = [
  {
    name: 'production app to production API',
    requestOrigin: 'https://openpencil-api.elf.dance',
    origin: 'https://design.elf.dance',
    allowed: true
  },
  {
    name: 'staging app to staging API',
    requestOrigin: 'https://staging-openpencil-api.elf.dance',
    origin: 'https://staging.design.elf.dance',
    allowed: true
  },
  {
    name: 'fixed-port desktop app to production API',
    requestOrigin: 'https://openpencil-api.elf.dance',
    origin: 'http://127.0.0.1:1420',
    allowed: true
  },
  {
    name: 'same local tree',
    requestOrigin: 'http://api.open-pencil.localhost:7300',
    origin: 'http://app.open-pencil.localhost:7300',
    allowed: true
  },
  {
    name: 'cross local tree',
    requestOrigin: 'http://api.open-pencil.localhost:7300',
    origin: 'http://app.other-tree.localhost:7300',
    allowed: false
  },
  {
    name: 'same development tree and box',
    requestOrigin: 'http://api.open-pencil.ch5-laptop-m5.dev.ch5.me:7300',
    origin: 'http://app.open-pencil.ch5-laptop-m5.dev.ch5.me:7300',
    allowed: true
  },
  {
    name: 'same development tree on another box',
    requestOrigin: 'http://api.open-pencil.ch5-laptop-m5.dev.ch5.me:7300',
    origin: 'http://app.open-pencil.other-box.dev.ch5.me:7300',
    allowed: false
  },
  {
    name: 'different development tree on the same box',
    requestOrigin: 'http://api.open-pencil.ch5-laptop-m5.dev.ch5.me:7300',
    origin: 'http://app.other-tree.ch5-laptop-m5.dev.ch5.me:7300',
    allowed: false
  },
  {
    name: 'development app to deployed API',
    requestOrigin: 'https://openpencil-api.elf.dance',
    origin: 'http://app.open-pencil.ch5-laptop-m5.dev.ch5.me:7300',
    allowed: false
  }
]

describe('CORS middleware', () => {
  for (const { name, requestOrigin, origin, allowed } of PREFLIGHT_CASES) {
    test(name, async () => {
      const response = await app.request(`${requestOrigin}/health`, {
        method: 'OPTIONS',
        headers: {
          host: new URL(requestOrigin).host,
          origin,
          'access-control-request-method': 'GET'
        }
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe(allowed ? origin : null)
      if (allowed) {
        expect(response.headers.get('access-control-allow-credentials')).toBe('true')
      }
    })
  }
})
