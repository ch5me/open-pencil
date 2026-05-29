import { isTauri } from './env'

const BEARER_TOKEN_KEY = 'call_function_qtvl25a1v2tp_1'

export const DESKTOP_CALLBACK_SCHEME = 'openpencil'

export type TauriOperatingMode = 'local-file' | 'hosted-docs' | 'hosted-collab'

// Sync-safe gate — always false in this phase until hosted desktop auth is explicitly enabled
function isDesktopHostedAuthEnabled(): boolean {
  return false
}

function isDesktopHostedDocsEnabled(): boolean {
  return false
}

// Deferred: once desktop hosted auth is enabled, wire through to the async flag system
export async function registerDesktopAuthCallback(
  _onCallback: (url: string) => void
): Promise<() => void> {
  if (!isTauri() || !isDesktopHostedAuthEnabled()) {
    return () => {
      /* disabled until gate flips */
    }
  }
  const { listen } = await import('@tauri-apps/api/event')
  const cleanup = await listen<string>('scheme-request-received', (event) => {
    _onCallback(event.payload)
  })
  return () => {
    cleanup()
  }
}

interface TauriStoreInstance {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  save: () => Promise<void>
}

interface TauriStoreLoader {
  Store: { load: (filename: string) => Promise<TauriStoreInstance> }
}

async function loadStore(): Promise<TauriStoreInstance | null> {
  if (!isTauri()) return null
  try {
    const mod = (await import('@tauri-apps/plugin-store')) as TauriStoreLoader
    return await mod.Store.load('auth.dat')
  } catch {
    return null
  }
}

export async function storeBearerToken(token: string | null): Promise<boolean> {
  if (!isDesktopHostedAuthEnabled()) return false
  const store = await loadStore()
  if (!store) return false
  if (token === null) {
    await store.delete(BEARER_TOKEN_KEY)
  } else {
    await store.set(BEARER_TOKEN_KEY, token)
  }
  await store.save()
  return true
}

export async function readBearerToken(): Promise<string | null> {
  if (!isDesktopHostedAuthEnabled()) return null
  const store = await loadStore()
  if (!store) return null
  const token = await store.get<string>(BEARER_TOKEN_KEY)
  return token ?? null
}

export async function clearBearerToken(): Promise<void> {
  if (!isTauri()) return
  const store = await loadStore()
  if (!store) return
  await store.delete(BEARER_TOKEN_KEY)
  await store.save()
}

export function resolveTauriOperatingMode(): TauriOperatingMode {
  if (isDesktopHostedAuthEnabled()) return 'local-file'
  if (isDesktopHostedDocsEnabled()) return 'hosted-docs'
  return 'local-file'
}

export function shouldShowHostedUI(): boolean {
  return isTauri() && isDesktopHostedAuthEnabled()
}
