import { ref, computed } from 'vue'
import {
  getSession,
  signIn as authSignIn,
  signOut as authSignOut,
  sendOtp as authSendOtp,
  verifyOtp as authVerifyOtp,
  signUp as authSignUp,
  type SessionUser,
  type SessionData,
} from './authTransport'

export interface OtpState {
  email: string
  message?: string
}

const SESSION_COOKIE_KEY = 'openpencil_session'

function getSessionCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE_KEY}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function clearSessionCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${SESSION_COOKIE_KEY}=; max-age=0; path=/`
}

const sessionData = ref<SessionData | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const user = computed<SessionUser | null>(() => sessionData.value?.user ?? null)
const isSignedIn = computed<boolean>(() => user.value !== null)
const sessionToken = computed<string | null>(() => getSessionCookie())

export function useHostedSession() {

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const data = await getSession()
      sessionData.value = data
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      sessionData.value = null
    } finally {
      loading.value = false
    }
  }

  async function signIn(email: string, password: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const data = await authSignIn(email, password)
      sessionData.value = data
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      loading.value = false
    }
  }

  async function signUp(email: string, password: string, name?: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const data = await authSignUp(email, password, name)
      sessionData.value = data
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      loading.value = false
    }
  }

  async function signOut(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      await authSignOut()
      sessionData.value = null
      clearSessionCookie()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      loading.value = false
    }
  }

  async function sendOtp(email: string): Promise<OtpState> {
    const result = await authSendOtp(email)
    return { email, message: result.message }
  }

  async function verifyOtp(email: string, code: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const data = await authVerifyOtp(email, code)
      sessionData.value = data
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      loading.value = false
    }
  }

  return {
    sessionData,
    user,
    isSignedIn,
    sessionToken,
    loading,
    error,
    refresh,
    signIn,
    signUp,
    signOut,
    sendOtp,
    verifyOtp,
  }
}
