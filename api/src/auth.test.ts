import { describe, it, expect } from 'bun:test'

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
