import { describe, expect, it } from 'bun:test'

import {
  resolveTauriOperatingMode,
  shouldShowHostedUI,
  storeBearerToken,
  readBearerToken,
  clearBearerToken,
  DESKTOP_CALLBACK_SCHEME,
  registerDesktopAuthCallback
} from '@/app/tauri/hosted'

describe('tauri/hosted - disabled seams', () => {
  describe('resolveTauriOperatingMode', () => {
    it('returns local-file when hosted auth is off', () => {
      expect(resolveTauriOperatingMode()).toBe('local-file')
    })
  })

  describe('shouldShowHostedUI', () => {
    it('returns false when hosted auth is off', () => {
      expect(shouldShowHostedUI()).toBe(false)
    })
  })

  describe('storeBearerToken', () => {
    it('returns false when hosted auth is off', async () => {
      const result = await storeBearerToken('fake-token')
      expect(result).toBe(false)
    })
  })

  describe('readBearerToken', () => {
    it('returns null when hosted auth is off', async () => {
      const result = await readBearerToken()
      expect(result).toBeNull()
    })
  })

  describe('clearBearerToken', () => {
    it('does not throw when hosted auth is off', async () => {
      await clearBearerToken()
    })
  })

  describe('registerDesktopAuthCallback', () => {
    it('returns a cleanup function without enabling desktop auth', async () => {
      const cleanup = await registerDesktopAuthCallback(() => {})
      expect(typeof cleanup).toBe('function')
      cleanup()
    })
  })

  describe('DESKTOP_CALLBACK_SCHEME', () => {
    it('is defined as openpencil', () => {
      expect(DESKTOP_CALLBACK_SCHEME).toBe('openpencil')
    })
  })
})
