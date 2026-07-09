import { createElfVerifier, type ElfVerifier } from '@ch5me/elf-auth-client'

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

export type AuthEnv = {
  ELF_JWKS_URL?: string
  ELF_ISSUER?: string
  ELF_AUDIENCE?: string
  ALLOW_DEV_STUB_AUTH?: string
}

export class AuthConfigurationError extends Error {
  readonly code = 'OPENPENCIL_AUTH_MISSING_PRECONDITION'

  constructor(name: keyof AuthEnv) {
    super(`Missing auth precondition: ${name}`)
    this.name = 'AuthConfigurationError'
  }
}

export const ELF_JWT_COOKIE = 'ELF_JWT'
export const DEV_STUB_ELF_TOKEN = 'call_30525cb2f86a407bad6be0f6'

let verifierCache: { key: string; verifier: ElfVerifier } | null = null

function readAuthEnv(env: AuthEnv | undefined, key: keyof AuthEnv): string | undefined {
  return env ? env[key] : globalThis.process?.env?.[key]
}

function isDevStubEnabled(env?: AuthEnv): boolean {
  return readAuthEnv(env, 'ALLOW_DEV_STUB_AUTH') === '1'
}

function requireAuthEnv(env: AuthEnv | undefined, key: keyof AuthEnv): string {
  const value = readAuthEnv(env, key)
  if (!value) throw new AuthConfigurationError(key)
  return value
}

export function assertAuthConfigured(env?: AuthEnv): void {
  if (isDevStubEnabled(env)) return
  requireAuthEnv(env, 'ELF_JWKS_URL')
  requireAuthEnv(env, 'ELF_ISSUER')
  requireAuthEnv(env, 'ELF_AUDIENCE')
}

function getRealVerifier(env?: AuthEnv): ElfVerifier | null {
  if (!readAuthEnv(env, 'ELF_JWKS_URL') && isDevStubEnabled(env)) return null

  const jwksUrl = requireAuthEnv(env, 'ELF_JWKS_URL')
  const issuer = requireAuthEnv(env, 'ELF_ISSUER')
  const audience = requireAuthEnv(env, 'ELF_AUDIENCE')
  const key = `${jwksUrl}\n${issuer}\n${audience}`
  if (verifierCache?.key === key) return verifierCache.verifier

  const verifier = createElfVerifier({ jwksUrl, issuer, audience })
  verifierCache = { key, verifier }
  return verifier
}

// ---------------------------------------------------------------------------
// Stub verifier — returns fixed user for DEV_STUB_ELF_TOKEN
// Local-dev only: reachable exclusively when ALLOW_DEV_STUB_AUTH=1 is set AND no
// real verifier is configured. Never reached in a deployed environment.
// ---------------------------------------------------------------------------

async function stubVerify(token: string): Promise<ElfTokenPayload | null> {
  if (token !== DEV_STUB_ELF_TOKEN) return null
  return {
    elfUserId: 'stub-user-001',
    exp: Date.now() / 1000 + 3600,
    iat: Date.now() / 1000
  }
}

export async function verifyElfToken(token: string, env?: AuthEnv): Promise<ElfTokenPayload | null> {
  const verifier = getRealVerifier(env)
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
  if (isDevStubEnabled(env)) {
    return stubVerify(token)
  }
  return null
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
  opts?: { cookieName?: string; env?: AuthEnv }
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
  const payload = await verifyElfToken(token, opts?.env)
  if (!payload) return { type: 'unauthorized', reason: 'invalid-token' }
  return { type: 'authenticated', userId: payload.elfUserId, token }
}

import type { MiddlewareHandler } from 'hono'

export function requireSession(opts?: { cookieName?: string }): MiddlewareHandler {
  return async (c, next) => {
    const result = await resolveSession(c.req.raw, { ...opts, env: c.env })
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
