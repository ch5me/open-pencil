import { isTauri } from './env'

function safeIsHostedAuthEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const { isHostedAuthEnabled } = require('@/app/hosted/flags')
  return isHostedAuthEnabled()
}

function safeIsHostedDocsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const { isHostedDocsEnabled } = require('@/app/hosted/flags')
  return isHostedDocsEnabled()
}

export const DESKTOP_CALLBACK_SCHEME = 'openpencil'

export async function registerDesktopAuthCallback(
  onCallback: (url: string) => void,
): Promise<() => void> {
  if (!isTauri() || !safeIsHostedAuthEnabled()) {
    return function cleanupNoop() { /* disabled until gate flips */ }
  }

  const { listen } = await import('@tauri-apps/api/event')
  const cleanup = await listen<string>('scheme-request-received', (event) => {
    onCallback(event.payload)
  })

  return () => {
    cleanup()
  }
}

const BEARER_TOKEN_KEY = 'elf_auth_bearer_token'

interface TauriStore {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  save: () => Promise<void>
}

interface TauriStoreModule {
  Store: {
    load: (filename: string) => Promise<TauriStore>
  }
}

async function loadStoreModule(): Promise<TauriStoreModule | null> {
  if (!isTauri()) return null
  try {
    // oxlint-disable-next-line import-x/no-unresolved
    const mod = await import('@tauri-apps/plugin-store')
    return mod as TauriStoreModule
  } catch {
    return null
  }
}

export async function storeBearerToken(token: string | null): Promise<boolean> {
  if (!safeIsHostedAuthEnabled()) return false

  const mod = await loadStoreModule()
  if (!mod) return false

  const store = await mod.Store.load('auth.dat')
  if (token === null) {
    await store.delete(BEARER_TOKEN_KEY)
  } else {
    await store.set(BEARER_TOKEN_KEY, token)
  }
  await store.save()
  return true
}

export async function readBearerToken(): Promise<string | null> {
  if (!safeIsHostedAuthEnabled()) return null

  const mod = await loadStoreModule()
  if (!mod) return null

  const store = await mod.Store.load('auth.dat')
  const token = await store.get<string>(BEARER_TOKEN_KEY)
  return token ?? null
}

export async function clearBearerToken(): Promise<void> {
  if (!isTauri()) return

  const mod = await loadStoreModule()
  if (!mod) return

  const store = await mod.Store.load('auth.dat')
  await store.delete(BEARER_TOKEN_KEY)
  await store.save()
}

export type TauriOperatingMode = 'local-file' | 'hosted-docs' | 'hosted-collab'

export function resolveTauriOperatingMode(): TauriOperatingMode {
  if (!safeIsHostedAuthEnabled()) return 'local-file'
  if (safeIsHostedDocsEnabled()) return 'hosted-docs'
  return 'local-file'
}

export function shouldShowHostedUI(): boolean {
  return isTauri() && safeIsHostedAuthEnabled()
}
