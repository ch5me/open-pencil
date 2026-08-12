import { afterEach, expect, setDefaultTimeout, spyOn, test } from 'bun:test'

import {
  layerMetadata,
  PsdCancelledError,
  PsdHostileFileError,
  rasterizePsdLayers,
  rasterizePsdLayersAdaptive,
  rasterizePsdLayersInWorker,
  type PsdRasterMetrics,
  type PsdRasterInput
} from '#core/io/formats/psd'

setDefaultTimeout(30_000)

const originalWorker = globalThis.Worker

afterEach(() => {
  Object.assign(globalThis, { Worker: originalWorker })
})

function rasterInput(layerCount: 100 | 512): PsdRasterInput {
  const width = 16
  const height = 16
  return {
    width,
    height,
    layers: Array.from({ length: layerCount }, (_, index) => ({
      ...layerMetadata(`layer-${index}`, `Layer ${index}`, { opacity: 0.5 }),
      raster: {
        width,
        height,
        pixels: new Uint8Array(width * height * 4).fill(index % 2 === 0 ? 255 : 128)
      }
    }))
  }
}

test('PSD worker reports real 100/512-layer composition metrics under main-thread budget', async () => {
  for (const layerCount of [100, 512] as const) {
    const input = rasterInput(layerCount)
    const firstInputBuffer = input.layers[0]?.raster?.pixels
    const expected = rasterizePsdLayers(input)
    const { pixels, metrics } = await rasterizePsdLayersInWorker(input)

    expect(pixels).toEqual(expected)
    expect(pixels.some((value) => value !== 0)).toBe(true)
    expect(metrics).toMatchObject({ execution: 'worker', layerCount })
    expect(metrics.mainThreadMs).toBeLessThanOrEqual(50)
    expect(metrics.workerMs).toBeGreaterThanOrEqual(0)
    expect(metrics.elapsedMs).toBeGreaterThanOrEqual(metrics.workerMs)
    expect(firstInputBuffer?.byteLength).toBe(input.width * input.height * 4)
  }
})

test('PSD worker preserves typed hostile-input failure and caller buffers', async () => {
  const input = rasterInput(100)
  const pixels = input.layers[0]?.raster?.pixels
  const malformed = {
    ...input,
    width: input.width + 1
  }

  await expect(rasterizePsdLayersInWorker(malformed)).rejects.toBeInstanceOf(PsdHostileFileError)
  expect(pixels?.byteLength).toBe(input.width * input.height * 4)
})

test('PSD worker rejects pre-cancelled work with the PSD cancellation type', async () => {
  const controller = new AbortController()
  controller.abort()

  await expect(
    rasterizePsdLayersInWorker(rasterInput(100), controller.signal)
  ).rejects.toBeInstanceOf(PsdCancelledError)
})

test('PSD worker terminates work cancelled after dispatch', async () => {
  const controller = new AbortController()
  const result = rasterizePsdLayersInWorker(rasterInput(512), controller.signal)
  controller.abort()

  await expect(result).rejects.toBeInstanceOf(PsdCancelledError)
})

test('PSD adaptive gate stays on main thread before a >50ms miss then activates worker', async () => {
  const input = rasterInput(100)
  const metrics: PsdRasterMetrics[] = []
  let workerDispatches = 0
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror = null

    postMessage(workerInput: PsdRasterInput) {
      workerDispatches += 1
      queueMicrotask(() => {
        this.onmessage?.({
          data: { pixels: rasterizePsdLayers(workerInput), workerMs: 1 }
        } as MessageEvent)
      })
    }

    terminate() {
      return undefined
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker })

  const clock = spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(51)
  const mainThreadPixels = await rasterizePsdLayersAdaptive(input, {
    workerAvailable: true,
    onMetrics: (value) => metrics.push(value)
  })
  clock.mockRestore()

  expect(workerDispatches).toBe(0)
  expect(mainThreadPixels).toEqual(rasterizePsdLayers(input))
  expect(metrics[0]).toMatchObject({ execution: 'main-thread', mainThreadMs: 51 })

  const workerPixels = await rasterizePsdLayersAdaptive(input, {
    workerAvailable: true,
    onMetrics: (value) => metrics.push(value)
  })

  expect(workerDispatches).toBe(1)
  expect(workerPixels).toEqual(mainThreadPixels)
  expect(metrics[1]).toMatchObject({ execution: 'worker', workerMs: 1 })
})

test('PSD worker terminates and rejects malformed onmessage', async () => {
  const workers: FakeWorker[] = []
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror = null
    terminated = false

    constructor() {
      workers.push(this)
    }

    postMessage() {
      queueMicrotask(() => this.onmessage?.({ data: null } as MessageEvent))
    }

    terminate() {
      this.terminated = true
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker })

  await expect(rasterizePsdLayersInWorker(rasterInput(100))).rejects.toThrow(
    'PSD raster worker returned malformed response'
  )
  expect(workers[0]?.terminated).toBe(true)
})

test('PSD worker terminates and rejects onerror', async () => {
  const workers: FakeWorker[] = []
  class FakeWorker {
    onmessage = null
    onerror: ((event: ErrorEvent) => void) | null = null
    terminated = false

    constructor() {
      workers.push(this)
    }

    postMessage() {
      queueMicrotask(() => this.onerror?.({ message: 'worker exploded' } as ErrorEvent))
    }

    terminate() {
      this.terminated = true
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker })

  await expect(rasterizePsdLayersInWorker(rasterInput(100))).rejects.toThrow('worker exploded')
  expect(workers[0]?.terminated).toBe(true)
})
