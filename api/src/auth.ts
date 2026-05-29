import type { ElfVerifier } from '@ch5me/elf-auth-client'

export type ElfUserId = string

export type ElfTokenPayload = {
  elfUserId: ElfUserId
  exp: number
  iat: number
}

export type SessionResult =
  | { type: 'authenticated'; userId: ElfUserId; token: string }
  | { type: 'unauthenticated' }
  | { type: 'unauthorized'; reason: 'identity-conflict' | 'invalid-token' }

export const ELF_JWT_COOKIE = 'ELF_JWT'
export const DEV_STUB_ELF_TOKEN = 'call_30525cb2f86a407bad6be0f6'

// ---------------------------------------------------------------------------
// Real ELF verifier wiring
// ---------------------------------------------------------------------------
// When ELF_JWKS_URL is set, use the canonical @ch5me/elf-auth-client verifier
// for RS256/JWKS token verification. When unset, fall back to the stub verifier
// for local development.
// ---------------------------------------------------------------------------

let _verifier: ElfVerifier | null = null
let _verifierInitialized = false

function getRealVerifier(): ElfVerifier | null {
  if (_verifierInitialized) return _verifier
  _verifierInitialized = true

  const jwksUrl = globalThis.process?.env?.ELF_JWKS_URL
  if (!jwksUrl) return null

  const issuer = globalThis.process?.env?.ELF_ISSUER ?? 'https://api.elf.dance'
  const audience = globalThis.process?.env?.ELF_AUDIENCE ?? 'elf-client'

  try {
    // Dynamic import to avoid crashing when the package is unavailable
    // (e.g., during local dev without the dependency installed)
    const { createElfVerifier } = require('@ch5me/elf-auth-client') as typeof import('@ch5me/elf-auth-client')
    _verifier = createElfVerifier({ jwksUrl, issuer, audience })
    return _verifier
  } catch {
    // Package not available — fall through to stub
    return null
  }
}

// ---------------------------------------------------------------------------
// Stub verifier — returns fixed user for DEV_STUB_ELF_TOKEN
// Used when no real JWKS endpoint is configured (local dev).
// ---------------------------------------------------------------------------

async function stubVerify(token: string): Promise<ElfTokenPayload | null> {
  if (token !== DEV_STUB_ELF_TOKEN) return null
  return {
    elfUserId: 'stub-user-001',
    exp: Date.now() / 1000 + 3600,
    iat: Date.now() / 1000
  }
}

// ---------------------------------------------------------------------------
// verifyElfToken — THE single auth swap boundary
//
// When a real ELF verifier is available (ELF_JWKS_URL set), use RS256/JWKS
// verification. Otherwise, fall back to stub for local dev.
// ---------------------------------------------------------------------------

export async function verifyElfToken(token: string): Promise<ElfTokenPayload | null> {
  const verifier = getRealVerifier()
  if (verifier) {
    const result = await verifier.verify(token)
    if (result.valid) {
      return {
        elfUserId: result.payload.elfUserId,
        exp: result.payload.exp ?? 0,
        iat: result.payload.iat ?? 0
      }
    }
    return null
  }
  return stubVerify(token)
}

// ---------------------------------------------------------------------------
// Token extraction helpers — framework-agnostic, unchanged
// ---------------------------------------------------------------------------

export function bearerToken(header: string | undefined | null): string | null {
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

export function cookieToken(cookieHeader: string | undefined | null, name: string): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(new RegExp(`(?:^|;)\\s*${name}=([^;]*)`))
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export function protocolToken(header: string | undefined | null): string | null {
  if (!header) return null
  const parts = header
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  for (const part of parts) {
    if (part.startsWith('bearer.')) return decodeURIComponent(part.slice('bearer.'.length))
  }
  return null
}

// ---------------------------------------------------------------------------
// Session resolver — framework-agnostic, unchanged
// ---------------------------------------------------------------------------

export async function resolveSession(
  request: Request,
  opts?: { cookieName?: string }
): Promise<SessionResult> {
  const cookieName = opts?.cookieName ?? ELF_JWT_COOKIE
  const cookieValue = cookieToken(request.headers.get('cookie'), cookieName)
  const bearerValue = bearerToken(request.headers.get('authorization'))
  const protocolValue = protocolToken(request.headers.get('sec-websocket-protocol'))
  const credentials = [cookieValue, bearerValue, protocolValue].filter(
    (value): value is string => value !== null
  )

  if (credentials.length === 0) return { type: 'unauthenticated' }
  if (new Set(credentials).size > 1) {
    return { type: 'unauthorized', reason: 'identity-conflict' }
  }

  const token = credentials[0] ?? ''
  const payload = await verifyElfToken(token)
  if (!payload) return { type: 'unauthorized', reason: 'invalid-token' }
  return { type: 'authenticated', userId: payload.elfUserId, token }
}

import type { MiddlewareHandler } from 'hono'

export function requireSession(opts?: { cookieName?: string }): MiddlewareHandler {
  return async (c, next) => {
    const result = await resolveSession(c.req.raw, opts)
    if (result.type !== 'authenticated') {
      return c.json(
        {
          error: 'unauthorized',
          reason: result.type === 'unauthorized' ? result.reason : 'missing-session'
        },
        401
      )
    }
    ;(c as any).set('userId', result.userId)
    ;(c as any).set('sessionToken', result.token)
    return next()
  }
}
