import type { Env } from './env'

export async function initSentry(env: Env): Promise<void> {
  if (!env.SENTRY_DSN) return

  const Sentry = await import('@sentry/cloudflare')
  Sentry.init({
    dsn: env.SENTRY_DSN,
    release: env.VERSION_METADATA?.version,
    environment: env.VERSION_METADATA?.deployedAt ? 'production' : 'development',
    tracesSampleRate: 0.1,
    integrations: [
      new Sentry.Integrations.Lambda(),
      new Sentry.Integrations.Llm(),
    ],
  })
}