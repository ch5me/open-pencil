import type { D1Database } from '@cloudflare/workers-types'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { emailOTP } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'

export const BETTER_AUTH_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function shouldUseCrossSiteCookies(publicAppUrl?: string, authUrl?: string): boolean {
  if (!publicAppUrl || !authUrl) return false

  try {
    return new URL(publicAppUrl).hostname !== new URL(authUrl).hostname
  } catch {
    return false
  }
}

function shouldUseSecureCookies(authUrl?: string, publicAppUrl?: string): boolean {
  const cookieUrl = authUrl ?? publicAppUrl
  if (!cookieUrl) return false

  try {
    return new URL(cookieUrl).protocol === 'https:'
  } catch {
    return false
  }
}

async function sendResendOtp(apiKey: string, email: string, otp: string): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'OpenPencil <no-reply@ch5.me>',
      to: [email],
      subject: 'Your OpenPencil verification code',
      text: `Your OpenPencil verification code is ${otp}`,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to send OTP email: ${response.status} ${body}`)
  }
}

export function createBetterAuth(
  db: D1Database,
  env: { RESEND_API_KEY?: string; PUBLIC_APP_URL?: string; BETTER_AUTH_URL?: string; BETTER_AUTH_SECRET?: string }
) {
  const database = drizzle(db)
  const authUrl = env.BETTER_AUTH_URL ?? env.PUBLIC_APP_URL
  const useCrossSiteCookies = shouldUseCrossSiteCookies(env.PUBLIC_APP_URL, authUrl)
  const config: BetterAuthOptions = {
    baseURL: authUrl,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database, {
      provider: 'sqlite',
      schema,
    }),
    session: {
      expiresIn: BETTER_AUTH_SESSION_COOKIE_MAX_AGE_SECONDS,
    },
    advanced: {
      useSecureCookies: shouldUseSecureCookies(authUrl, env.PUBLIC_APP_URL),
      defaultCookieAttributes: {
        sameSite: useCrossSiteCookies ? 'none' : 'lax',
        secure: shouldUseSecureCookies(authUrl, env.PUBLIC_APP_URL),
        partitioned: useCrossSiteCookies,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: {},
  }

  if (env.RESEND_API_KEY) {
    const resendApiKey = env.RESEND_API_KEY
    config.plugins = [
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          await sendResendOtp(resendApiKey, email, otp)
        },
        sendVerificationOnSignUp: false,
      }),
    ]
  }

  return betterAuth(config)
}
