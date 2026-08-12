import { getHostedConfig } from '@/app/hosted/flags'
import { IS_BROWSER } from '@/constants'

export type HostedRequestOptions = {
  apiOrigin?: string
  sessionToken?: () => string | null
  fetch?: typeof fetch
}

export class HostedAPIError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'HostedAPIError'
  }
}

function defaultSessionToken(): string | null {
  return IS_BROWSER ? (window.openPencil?.test?.hostedAuthToken ?? null) : null
}

export function createHostedRequester(options: HostedRequestOptions = {}) {
  const requestFetch = options.fetch ?? fetch

  return async function hostedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const origin = options.apiOrigin ?? getHostedConfig().apiOrigin
    if (!origin) {
      throw new HostedAPIError(0, 'api-origin-missing', 'Hosted API origin is not configured.')
    }

    const headers = new Headers(init.headers)
    const token = (options.sessionToken ?? defaultSessionToken)()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (init.body != null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await requestFetch(`${origin}${path}`, {
      ...init,
      credentials: 'include',
      headers
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string
        message?: string
      } | null
      throw new HostedAPIError(
        response.status,
        body?.error ?? 'unknown',
        body?.message ?? response.statusText
      )
    }

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}
