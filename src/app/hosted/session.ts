import { ref, readonly } from 'vue'

import { getHostedConfig } from '@/app/hosted/flags'
import { DEV_STUB_ELF_TOKEN } from '@/app/hosted/token'

export interface SessionUser {
  id: string
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'error' }

const sessionState = ref<SessionState>({ status: 'loading' })

function apiOrigin(): string {
  return getHostedConfig().apiOrigin || ''
}

export function getLoginUrl(): string | null {
  const config = getHostedConfig()
  const apiOrigin = config.apiOrigin
  const callbackUrl = config.authCallbackUrl

  if (!apiOrigin || !callbackUrl) return null

  const authUrl = new URL('/api/elf-auth/authorize', apiOrigin)
  authUrl.searchParams.set('redirect_uri', callbackUrl)
  authUrl.searchParams.set('response_type', 'code')
  return authUrl.toString()
}

export function redirectToLogin(): void {
  const url = getLoginUrl()
  if (url) {
    window.location.href = url
  }
}

async function fetchSession(): Promise<SessionState> {
  const origin = apiOrigin()
  if (!origin) return { status: 'unauthenticated' }
  const testToken = window.openPencil?.test?.hostedAuthToken ?? DEV_STUB_ELF_TOKEN

  try {
    const res = await fetch(`${origin}/api/session`, {
      credentials: 'include',
      headers: testToken ? { Authorization: `Bearer ${testToken}` } : undefined
    })
    if (!res.ok) return { status: 'error' }
    const body = (await res.json()) as { user: { id: string } | null; mode?: string }
    if (!body.user) return { status: 'unauthenticated' }
    return { status: 'authenticated', user: body.user }
  } catch {
    return { status: 'error' }
  }
}

export async function refreshSession() {
  sessionState.value = await fetchSession()
}

export function useSession() {
  return {
    state: readonly(sessionState),
    refreshSession
  }
}

export function isAuthenticated(): boolean {
  return sessionState.value.status === 'authenticated'
}

export function getSessionUserId(): string | null {
  return sessionState.value.status === 'authenticated' ? sessionState.value.user.id : null
}

export function seedHostedTestSession() {
  window.openPencil ??= {}
  window.openPencil.test ??= {}
  window.openPencil.test.hostedAuthToken = DEV_STUB_ELF_TOKEN
  sessionState.value = {
    status: 'authenticated',
    user: { id: 'stub-user-001' }
  }
}
