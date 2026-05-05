let initialized = false

export async function initSentry(): Promise<void> {
  if (initialized) return
  if (typeof window === 'undefined') return

  const apiKey = import.meta.env.VITE_SENTRY_DSN
  if (!apiKey) return

  try {
    const Sentry = await import('@sentry/vue')
    Sentry.init({
      dsn: apiKey,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.1,
    })
    initialized = true
  } catch {
  }
}
