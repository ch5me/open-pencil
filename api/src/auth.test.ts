import { describe, it, expect } from 'bun:test'

// The dev-stub verifier is opt-in and never active in deployed environments.
// Enable it here so the stub-path tests below can exercise the auth flow; the
// fail-closed guard tests at the bottom toggle it off explicitly.
process.env.ALLOW_DEV_STUB_AUTH = '1'

import {
  DEV_STUB_ELF_TOKEN,
  ELF_JWT_COOKIE,
  bearerToken,
  cookieToken,
  protocolToken,
  resolveSession,
  verifyElfToken
} from './auth'

// ---------------------------------------------------------------------------
// Helper: build a Request with specific cookie and/or auth header
// ---------------------------------------------------------------------------

function makeRequest(opts: { cookie?: string; authorization?: string } = {}) {
  const headers = new Headers()
  if (opts.cookie) headers.set('cookie', opts.cookie)
  if (opts.authorization) headers.set('authorization', opts.authorization)
  return new Request('http://localhost/api/test', { headers })
}

// ---------------------------------------------------------------------------
// Cookie + bearer extraction
// ---------------------------------------------------------------------------

describe('token extraction', () => {
  it('extracts bearer token from Authorization header', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123')
    expect(bearerToken('Basic abc123')).toBeNull()
    expect(bearerToken(undefined)).toBeNull()
    expect(bearerToken(null)).toBeNull()
    expect(bearerToken('')).toBeNull()
  })

  it('extracts named cookie from cookie header', () => {
    expect(cookieToken('foo=bar; ELF_JWT=tok1', 'ELF_JWT')).toBe('tok1')
    expect(cookieToken('ELF_JWT=tok2; foo=bar', 'ELF_JWT')).toBe('tok2')
    expect(cookieToken('foo=bar', 'ELF_JWT')).toBeNull()
    expect(cookieToken(undefined, 'test')).toBeNull()
    expect(cookieToken(null, 'test')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Stub verifier always returns the same user
// ---------------------------------------------------------------------------

describe('verifyElfToken (stub)', () => {
  it('returns a fixed stub user for the dev token', async () => {
    const payload = await verifyElfToken(DEV_STUB_ELF_TOKEN)
    expect(payload).not.toBeNull()
    expect(payload?.elfUserId).toBe('stub-user-001')
    expect(payload?.exp).toBeGreaterThan(Date.now() / 1000)
  })

  it('rejects any other token', async () => {
    expect(await verifyElfToken('anything-else')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Session resolver — doctrine tests
// ---------------------------------------------------------------------------

describe('resolveSession', () => {
  it('returns unauthenticated when no credentials provided', async () => {
    const result = await resolveSession(makeRequest())
    expect(result.type).toBe('unauthenticated')
  })

  it('authenticates with cookie-only (web browser path)', async () => {
    const result = await resolveSession(makeRequest({
      cookie: `${ELF_JWT_COOKIE}=${DEV_STUB_ELF_TOKEN}`
    }))
    expect(result.type).toBe('authenticated')
    expect((result as any).userId).toBe('stub-user-001')
  })

  it('authenticates with bearer-only (native/API path)', async () => {
    const result = await resolveSession(makeRequest({
      authorization: `Bearer ${DEV_STUB_ELF_TOKEN}`
    }))
    expect(result.type).toBe('authenticated')
    expect((result as any).userId).toBe('stub-user-001')
  })

  it('accepts cookie + bearer when same identity (idempotent)', async () => {
    const result = await resolveSession(makeRequest({
      cookie: `${ELF_JWT_COOKIE}=${DEV_STUB_ELF_TOKEN}`,
      authorization: `Bearer ${DEV_STUB_ELF_TOKEN}`
    }))
    expect(result.type).toBe('authenticated')
    expect((result as any).userId).toBe('stub-user-001')
  })

  it('rejects with identity-conflict when cookie and bearer differ', async () => {
    const result = await resolveSession(makeRequest({
      cookie: `${ELF_JWT_COOKIE}=cookie-tok`,
      authorization: 'Bearer bearer-tok'
    }))
    expect(result.type).toBe('unauthorized')
    expect((result as any).reason).toBe('identity-conflict')
  })

  it('custom cookie name works', async () => {
    const result = await resolveSession(makeRequest({
      cookie: 'custom_session=abc'
    }), { cookieName: 'custom_session' })
    expect(result.type).toBe('unauthorized')
  })

  it('custom cookie name works with the dev token', async () => {
    const result = await resolveSession(makeRequest({
      cookie: `custom_session=${DEV_STUB_ELF_TOKEN}`
    }), { cookieName: 'custom_session' })
    expect(result.type).toBe('authenticated')
  })

  it('extracts protocol token', () => {
    expect(protocolToken('openpencil-room.v1, bearer.test-token')).toBe('test-token')
    expect(protocolToken('openpencil-room.v1')).toBeNull()
  })

  it('authenticates with protocol token', async () => {
    const headers = new Headers()
    headers.set('sec-websocket-protocol', `openpencil-room.v1, bearer.${DEV_STUB_ELF_TOKEN}`)
    const result = await resolveSession(new Request('http://localhost/api/test', { headers }))
    expect(result.type).toBe('authenticated')
    expect((result as any).token).toBe(DEV_STUB_ELF_TOKEN)
  })
})

// ---------------------------------------------------------------------------
// Fail-closed guard — the dev-stub token must NOT authenticate in a deployed
// environment. With no real verifier configured (ELF_JWKS_URL unset) and the
// ALLOW_DEV_STUB_AUTH opt-in absent, verification returns null → 401. This is
// the security regression guard for the hardcoded stub token.
// ---------------------------------------------------------------------------

describe('verifyElfToken fail-closed (deployed default)', () => {
  async function withoutDevStub<T>(fn: () => Promise<T>): Promise<T> {
    const prev = process.env.ALLOW_DEV_STUB_AUTH
    delete process.env.ALLOW_DEV_STUB_AUTH
    try {
      return await fn()
    } finally {
      if (prev !== undefined) process.env.ALLOW_DEV_STUB_AUTH = prev
    }
  }

  it('rejects the dev-stub token when the opt-in flag is unset', async () => {
    await withoutDevStub(async () => {
      expect(await verifyElfToken(DEV_STUB_ELF_TOKEN)).toBeNull()
    })
  })

  it('resolveSession returns unauthorized/invalid-token for the stub token when the flag is unset', async () => {
    await withoutDevStub(async () => {
      const result = await resolveSession(new Request('http://localhost/api/test', {
        headers: { authorization: `Bearer ${DEV_STUB_ELF_TOKEN}` }
      }))
      expect(result.type).toBe('unauthorized')
      expect((result as any).reason).toBe('invalid-token')
    })
  })
})
