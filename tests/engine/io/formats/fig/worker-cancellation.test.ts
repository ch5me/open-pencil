import { expect, test } from 'bun:test'

import { parseFigViaWorker } from '#core/io/formats/fig/read'
import { IOCancelledError } from '#core/io/limits'

test('FIG worker cancellation terminates active archive parsing', async () => {
  const originalWorker = globalThis.Worker
  const instances: FakeWorker[] = []
  let abortListeners = 0

  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    posted = false
    terminated = false

    constructor() {
      instances.push(this)
    }

    postMessage() {
      this.posted = true
    }

    terminate() {
      this.terminated = true
    }
  }

  Object.assign(globalThis, { Worker: FakeWorker })
  try {
    const controller = new AbortController()
    const addEventListener = controller.signal.addEventListener.bind(controller.signal)
    const removeEventListener = controller.signal.removeEventListener.bind(controller.signal)
    controller.signal.addEventListener = ((
      ...args: Parameters<AbortSignal['addEventListener']>
    ) => {
      if (args[0] === 'abort') abortListeners += 1
      return addEventListener(...args)
    }) as AbortSignal['addEventListener']
    controller.signal.removeEventListener = ((
      ...args: Parameters<AbortSignal['removeEventListener']>
    ) => {
      if (args[0] === 'abort') abortListeners -= 1
      return removeEventListener(...args)
    }) as AbortSignal['removeEventListener']
    const parsing = parseFigViaWorker(new ArrayBuffer(8), { signal: controller.signal })
    const worker = instances[0]
    expect(worker?.posted).toBe(true)
    expect(abortListeners).toBe(1)

    controller.abort()

    await expect(parsing).rejects.toBeInstanceOf(IOCancelledError)
    expect(worker?.terminated).toBe(true)
    expect(abortListeners).toBe(0)
    worker?.onmessage?.({ data: { error: 'late result' } } as MessageEvent)
    worker?.onerror?.({ message: 'late error' } as ErrorEvent)
    expect(abortListeners).toBe(0)
  } finally {
    Object.assign(globalThis, { Worker: originalWorker })
  }
})

test('FIG worker cleanup runs when dispatch throws', async () => {
  const originalWorker = globalThis.Worker
  let terminated = false

  class ThrowingWorker {
    onmessage = null
    onerror = null

    postMessage() {
      throw new Error('post failed')
    }

    terminate() {
      terminated = true
    }
  }

  Object.assign(globalThis, { Worker: ThrowingWorker })
  try {
    await expect(parseFigViaWorker(new ArrayBuffer(8), {})).rejects.toThrow('post failed')
    expect(terminated).toBe(true)
  } finally {
    Object.assign(globalThis, { Worker: originalWorker })
  }
})

test('pre-cancelled FIG work never dispatches', async () => {
  const originalWorker = globalThis.Worker
  let posted = false
  let terminated = false

  class FakeWorker {
    onmessage = null
    onerror = null

    postMessage() {
      posted = true
    }

    terminate() {
      terminated = true
    }
  }

  Object.assign(globalThis, { Worker: FakeWorker })
  try {
    const controller = new AbortController()
    controller.abort()
    await expect(
      parseFigViaWorker(new ArrayBuffer(8), { signal: controller.signal })
    ).rejects.toBeInstanceOf(IOCancelledError)
    expect(posted).toBe(false)
    expect(terminated).toBe(true)
  } finally {
    Object.assign(globalThis, { Worker: originalWorker })
  }
})
