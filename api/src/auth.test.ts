import { afterAll, describe, expect, it } from 'bun:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

import {
  AuthConfigurationError,
  DEV_STUB_ELF_TOKEN,
  ELF_JWT_COOKIE,
  assertAuthConfigured,
  bearerToken,
  cookieToken,
  protocolToken,
  resolveSession,
  verifyElfToken,
  type AuthEnv,
  type SessionResult
} from './auth'

const stubAuthEnv: AuthEnv = { ALLOW_DEV_STUB_AUTH: '1' }
const issuer = 'https://auth.test'
const audience = 'open-pencil-test'
const keyId = 'open-pencil-test-key'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = {
  ...await exportJWK(publicKey),
  alg: 'RS256',
  kid: keyId,
  use: 'sig'
}
const jwksServer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: () => Response.json({ keys: [jwk] })
})
const realAuthEnv: AuthEnv = {
  ELF_JWKS_URL: `http://127.0.0.1:${jwksServer.port}/jwks.json`,
  ELF_ISSUER: issuer,
  ELF_AUDIENCE: audience
}

afterAll(() => {
  jwksServer.stop(true)
})

function makeRequest(opts: { cookie?: string; authorization?: string } = {}) {
  const headers = new Headers()
  if (opts.cookie) headers.set('cookie', opts.cookie)
  if (opts.authorization) headers.set('authorization', opts.authorization)
  return new Request('http://localhost/api/test', { headers })
}

function expectAuthenticated(result: SessionResult) {
  expect(result.type).toBe('authenticated')
  if (result.type !== 'authenticated') throw new Error(`Expected authenticated, got ${result.type}`)
  return result
}

function expectUnauthorized(result: SessionResult) {
  expect(result.type).toBe('unauthorized')
  if (result.type !== 'unauthorized') throw new Error(`Expected unauthorized, got ${result.type}`)
  return result
}

function captureConfigurationError(run: () => void): AuthConfigurationError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(AuthConfigurationError)
    if (error instanceof AuthConfigurationError) return error
    throw error
  }
  throw new Error('Expected AuthConfigurationError')
}

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

describe('auth configuration', () => {
  const missingConfigCases: Array<{
    env: AuthEnv
    missing: 'ELF_JWKS_URL' | 'ELF_ISSUER' | 'ELF_AUDIENCE'
  }> = [
    { env: {}, missing: 'ELF_JWKS_URL' },
    { env: { ELF_JWKS_URL: 'https://auth.test/jwks' }, missing: 'ELF_ISSUER' },
    {
      env: { ELF_JWKS_URL: 'https://auth.test/jwks', ELF_ISSUER: issuer },
      missing: 'ELF_AUDIENCE'
    }
  ]

  for (const { env, missing } of missingConfigCases) {
    it(`throws typed error when ${missing} is missing`, () => {
      const error = captureConfigurationError(() => assertAuthConfigured(env))
      expect(error.code).toBe('OPENPENCIL_AUTH_MISSING_PRECONDITION')
      expect(error.message).toBe(`Missing auth precondition: ${missing}`)
    })
  }

  it('enables the dev stub only for the exact value 1', async () => {
    const payload = await verifyElfToken(DEV_STUB_ELF_TOKEN, stubAuthEnv)
    expect(payload?.elfUserId).toBe('stub-user-001')

    for (const env of [{}, { ALLOW_DEV_STUB_AUTH: '0' }, { ALLOW_DEV_STUB_AUTH: 'true' }]) {
      await expect(verifyElfToken(DEV_STUB_ELF_TOKEN, env)).rejects.toBeInstanceOf(
        AuthConfigurationError
      )
    }
  })

  it('rejects non-stub tokens while explicit dev mode is enabled', async () => {
    expect(await verifyElfToken('anything-else', stubAuthEnv)).toBeNull()
  })
})

describe('configured RS256/JWKS verifier', () => {
  it('accepts a valid token from the configured issuer and audience', async () => {
    const issuedAt = 1_800_000_000
    const token = await new SignJWT({
      version: 3,
      elfUserId: 'elf-user-123',
      apiTokenPepper: null
    })
      .setProtectedHeader({ alg: 'RS256', kid: keyId })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .sign(privateKey)

    expect(await verifyElfToken(token, realAuthEnv)).toEqual({
      elfUserId: 'elf-user-123',
      exp: issuedAt + 300,
      iat: issuedAt
    })
  })

  it('rejects garbage instead of authenticating it', async () => {
    expect(await verifyElfToken('not-a-jwt', realAuthEnv)).toBeNull()
  })
})

describe('resolveSession', () => {
  it('returns unauthenticated when no credentials are provided', async () => {
    expect(await resolveSession(makeRequest())).toEqual({ type: 'unauthenticated' })
  })

  it('authenticates with cookie-only credentials', async () => {
    const result = expectAuthenticated(await resolveSession(makeRequest({
      cookie: `${ELF_JWT_COOKIE}=${DEV_STUB_ELF_TOKEN}`
    }), { env: stubAuthEnv }))
    expect(result.userId).toBe('stub-user-001')
  })

  it('authenticates with bearer-only credentials', async () => {
    const result = expectAuthenticated(await resolveSession(makeRequest({
      authorization: `Bearer ${DEV_STUB_ELF_TOKEN}`
    }), { env: stubAuthEnv }))
    expect(result.userId).toBe('stub-user-001')
  })

  it('accepts matching cookie and bearer credentials', async () => {
    const result = expectAuthenticated(await resolveSession(makeRequest({
      cookie: `${ELF_JWT_COOKIE}=${DEV_STUB_ELF_TOKEN}`,
      authorization: `Bearer ${DEV_STUB_ELF_TOKEN}`
    }), { env: stubAuthEnv }))
    expect(result.userId).toBe('stub-user-001')
  })

  it('rejects conflicting cookie and bearer credentials before verification', async () => {
    const result = expectUnauthorized(await resolveSession(makeRequest({
      cookie: `${ELF_JWT_COOKIE}=cookie-token`,
      authorization: 'Bearer bearer-token'
    })))
    expect(result.reason).toBe('identity-conflict')
  })

  it('uses a custom cookie name', async () => {
    const result = expectAuthenticated(await resolveSession(makeRequest({
      cookie: `custom_session=${DEV_STUB_ELF_TOKEN}`
    }), { cookieName: 'custom_session', env: stubAuthEnv }))
    expect(result.userId).toBe('stub-user-001')
  })

  it('extracts protocol token', () => {
    expect(protocolToken('openpencil-room.v1, bearer.test-token')).toBe('test-token')
    expect(protocolToken('openpencil-room.v1')).toBeNull()
  })

  it('authenticates with protocol credentials', async () => {
    const headers = new Headers({
      'sec-websocket-protocol': `openpencil-room.v1, bearer.${DEV_STUB_ELF_TOKEN}`
    })
    const result = expectAuthenticated(await resolveSession(
      new Request('http://localhost/api/test', { headers }),
      { env: stubAuthEnv }
    ))
    expect(result.token).toBe(DEV_STUB_ELF_TOKEN)
  })
})
