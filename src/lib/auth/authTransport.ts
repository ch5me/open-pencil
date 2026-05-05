const API_BASE_URL = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL
  ? String(import.meta.env.VITE_API_BASE_URL)
  : 'https://api.pencil.ch5.me'

export interface AuthFetchOptions {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
}

interface AuthErrorResult {
  error?: { message?: string; statusText?: string } | string
}

function buildAuthNetworkError(requestUrl: string, error: unknown): Error {
  const detail = error instanceof Error && error.message ? ` Original error: ${error.message}` : ''
  return new Error(`Network request failed while contacting ${requestUrl}.${detail}`)
}

function buildRequestUrl(path: string): string {
  return `${API_BASE_URL}/api/auth${path}`
}

export async function request<T>(path: string, options: AuthFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}

  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(buildRequestUrl(path), {
      method: options.method ?? 'GET',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
    })
  } catch (error) {
    throw buildAuthNetworkError(buildRequestUrl(path), error)
  }

  const data = (await response.json().catch(() => null)) as T | AuthErrorResult | null

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? typeof data.error === 'string'
          ? data.error
          : (data.error as Record<string, unknown>)?.message ||
            ((data.error as Record<string, unknown>)?.statusText as string | undefined) ||
            `Auth request failed (${response.status})`
        : `Auth request failed (${response.status})`
    throw new Error(String(message))
  }

  return data as T
}

export interface SessionUser {
  id: string
  email: string
  name?: string | null
}

export interface SessionData {
  user: SessionUser | null
  session: unknown | null
}

export async function getSession(): Promise<SessionData | null> {
  try {
    const data = await request<SessionData>('/session')
    return data
  } catch {
    return null
  }
}

export async function signUp(email: string, password: string, name?: string): Promise<SessionData> {
  return request<SessionData>('/sign-up', {
    method: 'POST',
    body: { email, password, ...(name ? { name } : {}) },
  })
}

export async function signIn(email: string, password: string): Promise<SessionData> {
  return request<SessionData>('/sign-in', {
    method: 'POST',
    body: { email, password },
  })
}

export async function signOut(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/sign-out', {
    method: 'POST',
  })
}

export async function sendOtp(email: string): Promise<{ ok: boolean; message?: string }> {
  return request<{ ok: boolean; message?: string }>('/otp/send', {
    method: 'POST',
    body: { email },
  })
}

export async function verifyOtp(email: string, code: string): Promise<SessionData> {
  return request<SessionData>('/otp/verify', {
    method: 'POST',
    body: { email, code },
  })
}