import { ref, computed } from 'vue'
import { getSession, signIn, signUp, signOut } from '../lib/auth/authTransport'

const session = ref<{ userId: string; email: string } | null>(null)
let initialized = false

export function useHostedAuth() {
  async function init() {
    if (initialized) return
    initialized = true
    const data = await getSession()
    if (data?.user) {
      session.value = { userId: data.user.id, email: data.user.email }
    }
  }

  const isAuthenticated = computed(() => session.value !== null)

  async function signInHosted(email: string, password: string): Promise<void> {
    const result = await signIn(email, password)
    if (result.user) {
      session.value = { userId: result.user.id, email: result.user.email }
    }
  }

  async function signUpHosted(email: string, password: string, name?: string): Promise<void> {
    const result = await signUp(email, password, name)
    if (result.user) {
      session.value = { userId: result.user.id, email: result.user.email }
    }
  }

  async function signOutHosted(): Promise<void> {
    await signOut()
    session.value = null
  }

  return { session: readonly(session), isAuthenticated, init, signInHosted, signUpHosted, signOutHosted }
}