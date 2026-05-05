import type { D1Database } from '@cloudflare/workers-types'
import { betterAuth, BetterAuthConfig } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { emailOTP } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'

export const BETTER_AUTH_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

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
  const config: BetterAuthConfig = {
    baseURL: env.BETTER_AUTH_URL ?? env.PUBLIC_APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database, {
      provider: 'sqlite',
      schema,
    }),
    session: {
      cookieName: 'better-auth.session_token',
      cookieMaxAge: BETTER_AUTH_SESSION_COOKIE_MAX_AGE_SECONDS,
      cookieAttributes: {
        sameSite: 'lax',
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
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
