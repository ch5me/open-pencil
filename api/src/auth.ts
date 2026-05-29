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
export const DEV_STUB_ELF_TOKEN = 'openpencil-hosted-dev-token'

export async function verifyElfToken(token: string): Promise<ElfTokenPayload | null> {
  if (token !== DEV_STUB_ELF_TOKEN) return null
  return {
    elfUserId: 'stub-user-001',
    exp: Date.now() / 1000 + 3600,
    iat: Date.now() / 1000
  }
}

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
