import { IS_BROWSER } from '@open-pencil/core/constants'

function resolveApiBaseUrl(): string {
  if (import.meta.env.VITE_API_BASE_URL) {
    return String(import.meta.env.VITE_API_BASE_URL)
  }

  if (IS_BROWSER) {
    if (window.location.hostname === 'web.openpencil.localhost') {
      return 'http://api.openpencil.localhost:8787'
    }
    if (window.location.hostname === 'pencil.ch5.me') return 'https://api.pencil.ch5.me'
    if (window.location.hostname === 'staging.pencil.ch5.me')
      return 'https://api.staging.pencil.ch5.me'
  }

  return 'https://api.pencil.ch5.me'
}

export const API_BASE_URL = resolveApiBaseUrl()

export interface AuthFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  body?: Record<string, unknown>
}

interface AuthErrorResult {
  error?: { message?: string; statusText?: string } | string
}

function getAuthErrorMessage(data: unknown, status: number): string {
  if (!data || typeof data !== 'object' || !('error' in data)) {
    return `Auth request failed (${status})`
  }

  const errorValue = data.error
  if (typeof errorValue === 'string') return errorValue
  if (isRecord(errorValue) && typeof errorValue.message === 'string') return errorValue.message
  if (isRecord(errorValue) && typeof errorValue.statusText === 'string')
    return errorValue.statusText
  return `Auth request failed (${status})`
}

function buildAuthNetworkError(requestUrl: string, error: unknown): Error {
  const detail = error instanceof Error && error.message ? ` Original error: ${error.message}` : ''
  return new Error(`Network request failed while contacting ${requestUrl}.${detail}`)
}

function buildRequestUrl(path: string): string {
  return `${API_BASE_URL}/api/auth${path}`
}

function buildApiRequestUrl(path: string): string {
  return `${API_BASE_URL}${path}`
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
      credentials: 'include'
    })
  } catch (error) {
    throw buildAuthNetworkError(buildRequestUrl(path), error)
  }

  const data = (await response.json().catch(() => null)) as T | AuthErrorResult | null

  if (!response.ok) {
    throw new Error(getAuthErrorMessage(data, response.status))
  }

  return data as T
}

export async function apiRequest<T>(path: string, options: AuthFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}

  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(buildApiRequestUrl(path), {
      method: options.method ?? 'GET',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include'
    })
  } catch (error) {
    throw buildAuthNetworkError(buildApiRequestUrl(path), error)
  }

  const data = (await response.json().catch(() => null)) as T | AuthErrorResult | null

  if (!response.ok) {
    throw new Error(getAuthErrorMessage(data, response.status))
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
  session: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeSessionData(data: unknown): SessionData | null {
  if (!isRecord(data)) return null

  const directUser = 'user' in data ? (data.user as SessionUser | null | undefined) : undefined
  const directSession = 'session' in data ? data.session : undefined

  if (directUser !== undefined && (!isRecord(directSession) || !('user' in directSession))) {
    return {
      user: directUser ?? null,
      session: directSession ?? null
    }
  }

  const nested = directSession
  if (isRecord(nested)) {
    return {
      user: ('user' in nested ? (nested.user as SessionUser | null | undefined) : null) ?? null,
      session: ('session' in nested ? nested.session : null) ?? null
    }
  }

  return null
}

export async function getSession(): Promise<SessionData | null> {
  try {
    const data = await request<unknown>('/session')
    return normalizeSessionData(data)
  } catch {
    return null
  }
}

export async function signUp(email: string, password: string, name?: string): Promise<SessionData> {
  const data = await request<unknown>('/sign-up', {
    method: 'POST',
    body: { email, password, ...(name ? { name } : {}) }
  })
  return normalizeSessionData(data) ?? { user: null, session: null }
}

export async function signIn(email: string, password: string): Promise<SessionData> {
  const data = await request<unknown>('/sign-in', {
    method: 'POST',
    body: { email, password }
  })
  return normalizeSessionData(data) ?? { user: null, session: null }
}

export async function signOut(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/sign-out', {
    method: 'POST'
  })
}

export async function sendOtp(email: string): Promise<{ ok: boolean; message?: string }> {
  return request<{ ok: boolean; message?: string }>('/otp/send', {
    method: 'POST',
    body: { email }
  })
}

export async function verifyOtp(email: string, code: string): Promise<SessionData> {
  const data = await request<unknown>('/otp/verify', {
    method: 'POST',
    body: { email, code }
  })
  return normalizeSessionData(data) ?? { user: null, session: null }
}
