import { ref, readonly } from 'vue'

import {
  createFederationClient,
  type SessionClient,
  type SessionState,
  type SessionUser,
  type SessionResolveOutcome
} from '@open-pencil/federation'

import { getHostedConfig } from '@/app/hosted/flags'
import { DEV_STUB_ELF_TOKEN } from '@/app/hosted/token'

export type { SessionState, SessionUser, SessionResolveOutcome }

let _client: { session: SessionClient } | null = null

function getSessionClient(): { session: SessionClient } | null {
  if (_client) return _client
  const origin = getHostedConfig().apiOrigin
  if (!origin) return null
  const testToken = window.openPencil?.test?.hostedAuthToken
  const token = testToken ?? DEV_STUB_ELF_TOKEN
  _client = createFederationClient({
    apiOrigin: origin,
    getToken: () => token
  })
  return _client
}

const sessionState = ref<SessionState>({ status: 'loading' })

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
  const client = getSessionClient()
  if (!client) return { status: 'unauthenticated' }

  try {
    return await client.session.state()
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
