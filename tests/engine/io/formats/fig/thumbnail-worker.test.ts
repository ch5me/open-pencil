import { afterEach, beforeAll, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderFigThumbnail } from '#core/io/formats/fig/export'
import { headlessRenderThumbnail, renderFixedThumbnailViaWorker } from '#core/io/formats/raster'
import { IOCancelledError } from '#core/io/limits'
import { initCodec } from '#core/kiwi'
import { fontManager } from '#core/text/fonts'

const originalWorker = globalThis.Worker

beforeAll(async () => {
  await initCodec()
})

afterEach(() => {
  Object.assign(globalThis, { Worker: originalWorker })
})

function thumbnailGraph() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.createNode('RECTANGLE', page.id, {
    x: 10,
    y: 20,
    width: 120,
    height: 80,
    fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 }, opacity: 1, visible: true }]
  })
  return { graph, page }
}

test('fixed-thumbnail worker matches exact direct bytes and dimensions', async () => {
  const { graph, page } = thumbnailGraph()
  const direct = await headlessRenderThumbnail(graph, page.id, 400, 225)
  const worker = await renderFixedThumbnailViaWorker(graph, page.id, 400, 225)

  expect(worker).toEqual(direct)
})

test('FIG thumbnail falls back to exact direct headless bytes and observes cancellation', async () => {
  Object.assign(globalThis, { Worker: undefined })
  const { graph, page } = thumbnailGraph()
  const direct = await headlessRenderThumbnail(graph, page.id, 400, 225)

  await expect(renderFigThumbnail(graph, page.id, undefined, undefined, true)).resolves.toEqual(
    direct
  )

  const controller = new AbortController()
  const cancelled = renderFigThumbnail(
    graph,
    page.id,
    undefined,
    undefined,
    true,
    controller.signal
  )
  controller.abort()

  await expect(cancelled).rejects.toBeInstanceOf(IOCancelledError)
})

test('fixed-thumbnail worker carries page fonts without detaching bytes', async () => {
  let request:
    | {
        kind?: string
        width?: number
        height?: number
        fontSnapshot?: { fonts: Array<{ family: string; style: string; data: ArrayBuffer }> }
      }
    | undefined
  const instances: FakeWorker[] = []
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror = null
    transfer: Transferable[] | undefined

    constructor() {
      instances.push(this)
    }

    postMessage(value: typeof request, transfer: Transferable[]) {
      request = value
      this.transfer = transfer
    }

    terminate() {
      return undefined
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker })

  const { graph, page } = thumbnailGraph()
  const family = `ThumbnailWorker_${Date.now()}`
  const bytes = new Uint8Array([0, 1, 0, 0, 7, 8, 9, 10]).buffer
  graph.createNode('TEXT', page.id, {
    text: 'Thumbnail',
    fontFamily: family,
    fontWeight: 400,
    width: 100,
    height: 30
  })
  fontManager.markLoaded(family, 'Regular', bytes)

  const rendering = renderFixedThumbnailViaWorker(graph, page.id, 400, 225)
  await Bun.sleep(0)

  expect(request?.kind).toBe('fixed-thumbnail')
  expect(request?.width).toBe(400)
  expect(request?.height).toBe(225)
  expect(request?.fontSnapshot?.fonts).toContainEqual({ family, style: 'Regular', data: bytes })
  expect(instances[0]?.transfer).toEqual([])
  expect(bytes.byteLength).toBe(8)

  instances[0]?.onmessage?.({
    data: { kind: 'fixed-thumbnail', width: 400, height: 225, bytes: new Uint8Array([1]) }
  } as MessageEvent)
  await expect(rendering).resolves.toEqual(new Uint8Array([1]))
})

test('fixed-thumbnail cancellation and timeout terminate active work', async () => {
  const workers: FakeWorker[] = []
  class FakeWorker {
    onmessage = null
    onerror = null
    terminated = false

    constructor() {
      workers.push(this)
    }

    postMessage() {
      return undefined
    }

    terminate() {
      this.terminated = true
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker })

  const { graph, page } = thumbnailGraph()
  const controller = new AbortController()
  const cancelled = renderFixedThumbnailViaWorker(graph, page.id, 400, 225, controller.signal)
  await Bun.sleep(0)
  controller.abort()
  await expect(cancelled).rejects.toBeInstanceOf(IOCancelledError)
  expect(workers[0]?.terminated).toBe(true)

  await expect(
    renderFixedThumbnailViaWorker(graph, page.id, 400, 225, undefined, 1)
  ).rejects.toBeInstanceOf(IOCancelledError)
  expect(workers[1]?.terminated).toBe(true)
})
