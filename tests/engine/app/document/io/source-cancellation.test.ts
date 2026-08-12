import { afterEach, describe, expect, test, vi } from 'bun:test'

import { createAbortableSaveOperation } from '@/app/document/autosave/create'
import { observeSaveAction } from '@/app/document/io/source'

afterEach(() => {
  vi.restoreAllMocks()
})

function cancellation(name: 'AbortError' | 'IOCancelledError'): Error {
  return Object.assign(new Error('Save cancelled'), { name })
}

describe('public save actions', () => {
  test.each(['AbortError', 'IOCancelledError'] as const)(
    'handles expected %s supersession when fire-and-forgotten',
    async (name) => {
      const unhandled: unknown[] = []
      const listener = (error: unknown) => unhandled.push(error)
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      process.on('unhandledRejection', listener)

      try {
        const operation = createAbortableSaveOperation()
        observeSaveAction(
          operation.run(async (signal) => {
            await Promise.resolve()
            if (signal.aborted) throw cancellation(name)
          })
        )
        await operation.run(async () => undefined)
        await Bun.sleep(0)
      } finally {
        process.off('unhandledRejection', listener)
      }

      expect(unhandled).toEqual([])
      expect(consoleError).not.toHaveBeenCalled()
    }
  )

  test('keeps expected cancellation rejectable for awaited callers', async () => {
    const error = cancellation('AbortError')
    await expect(observeSaveAction(Promise.reject(error))).rejects.toBe(error)
  })

  test('keeps real failures logged and rejectable', async () => {
    const error = new Error('disk full')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const save = observeSaveAction(Promise.reject(error))

    await expect(save).rejects.toBe(error)
    expect(consoleError).toHaveBeenCalledWith('Save failed:', error)
  })
})
