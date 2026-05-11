import { IS_BROWSER } from '@open-pencil/core/constants'

let initialized = false

export function initPostHog(): void {
  if (initialized) return
  if (!IS_BROWSER) return

  const key = import.meta.env.VITE_POSTHOG_API_KEY
  if (!key) return

  try {
    const posthog = (window as unknown as { posthog?: { init: (key: string) => void } }).posthog
    if (posthog) {
      posthog.init(key)
      initialized = true
    }
  } catch (err) {
    console.warn('[PostHog] init failed:', err)
  }
}

export function trackEvent(name: string, properties?: Record<string, unknown>): void {
  if (!IS_BROWSER) return
  const posthog = (
    window as unknown as {
      posthog?: { capture: (name: string, props?: Record<string, unknown>) => void }
    }
  ).posthog
  posthog?.capture(name, properties)
}
