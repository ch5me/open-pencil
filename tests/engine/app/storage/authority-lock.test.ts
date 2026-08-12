import { afterEach, expect, test } from 'bun:test'

import {
  StorageSyncAuthorityUnsupportedError,
  withCanvasMutationAuthority,
  withCanvasSyncAuthority
} from '@/app/storage/sync/authority-lock'

const originalNavigator = globalThis.navigator

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator
  })
})

test('missing Web Locks fails before remote effect', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {}
  })
  let effects = 0

  await expect(
    withCanvasSyncAuthority('canvas-1', async () => {
      effects++
    })
  ).rejects.toBeInstanceOf(StorageSyncAuthorityUnsupportedError)
  expect(effects).toBe(0)
})

test('rejected Web Locks fails before remote effect', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async () => {
          throw Object.assign(new Error('lock service rejected'), { name: 'NotSupportedError' })
        }
      }
    }
  })
  let effects = 0

  await expect(
    withCanvasSyncAuthority('canvas-1', async () => {
      effects++
    })
  ).rejects.toMatchObject({
    name: 'StorageSyncAuthorityUnsupportedError',
    message: 'Storage sync authority rejected: lock service rejected'
  })
  expect(effects).toBe(0)
})

test('action failures keep their original type', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async (_name: string, action: () => Promise<void>) => action()
      }
    }
  })
  const failure = new Error('remote failed')

  await expect(
    withCanvasSyncAuthority('canvas-1', async () => {
      throw failure
    })
  ).rejects.toBe(failure)
})

test('mutation action failures are not retried outside the lock', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async (_name: string, action: () => Promise<void>) => action()
      }
    }
  })
  const failure = new Error('durable write failed')
  let attempts = 0

  await expect(
    withCanvasMutationAuthority('canvas-1', async () => {
      attempts++
      throw failure
    })
  ).rejects.toBe(failure)
  expect(attempts).toBe(1)
})

test('mutation authority falls back only when Web Locks are unsupported', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async () => {
          throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })
        }
      }
    }
  })
  let attempts = 0

  await expect(
    withCanvasMutationAuthority('canvas-1', async () => {
      attempts++
      return 'saved'
    })
  ).resolves.toBe('saved')
  expect(attempts).toBe(1)
})

test('save publication and remote effects share one per-canvas lock', async () => {
  const tails = new Map<string, Promise<void>>()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async <T>(name: string, action: () => Promise<T>) => {
          const previous = tails.get(name) ?? Promise.resolve()
          let release!: () => void
          const current = new Promise<void>((resolve) => {
            release = resolve
          })
          tails.set(name, current)
          await previous
          try {
            return await action()
          } finally {
            release()
          }
        }
      }
    }
  })
  const order: string[] = []
  let releasePublication!: () => void
  const publicationHeld = new Promise<void>((resolve) => {
    releasePublication = resolve
  })

  const publication = withCanvasMutationAuthority('canvas-1', async () => {
    order.push('publication:start')
    await publicationHeld
    order.push('publication:end')
  })
  await Promise.resolve()
  const remoteEffect = withCanvasSyncAuthority('canvas-1', async () => {
    order.push('remote')
  })
  await Promise.resolve()

  expect(order).toEqual(['publication:start'])
  releasePublication()
  await Promise.all([publication, remoteEffect])
  expect(order).toEqual(['publication:start', 'publication:end', 'remote'])
})

test('action-thrown NotSupportedError executes once and keeps original rejection', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async <T>(_name: string, action: () => Promise<T>) => action()
      }
    }
  })
  const failure = Object.assign(new Error('action unsupported'), { name: 'NotSupportedError' })
  let attempts = 0

  await expect(
    withCanvasMutationAuthority('canvas-1', async () => {
      attempts++
      throw failure
    })
  ).rejects.toBe(failure)
  expect(attempts).toBe(1)
})
