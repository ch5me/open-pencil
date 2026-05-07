import type { Context } from 'hono'

import { createBetterAuth } from './better-auth'
import type { Env } from '../env'

export interface AuthenticatedUser {
  id: string
  email: string
}

export async function getAuthenticatedUser(
  c: Context<{ Bindings: Env }>
): Promise<AuthenticatedUser | null> {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length)
    const row = await c.env.DB.prepare(
      `SELECT sessions.userId AS userId, users.email AS email
       FROM sessions
       JOIN users ON users.id = sessions.userId
       WHERE sessions.token = ? AND sessions.expiresAt > ?`
    )
      .bind(token, Date.now())
      .first<{ userId: string; email: string }>()

    if (!row?.userId || !row.email) return null
    return { id: row.userId, email: row.email }
  }

  const auth = createBetterAuth(c.env.DB, {
    RESEND_API_KEY: c.env.RESEND_API_KEY,
    PUBLIC_APP_URL: c.env.PUBLIC_APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  })
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user?.id || !session.user.email) return null
  return { id: session.user.id, email: session.user.email }
}

export function isCh5Email(email: string): boolean {
  return email.toLowerCase().endsWith('@ch5.me')
}
