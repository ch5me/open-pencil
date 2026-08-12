import { afterAll, beforeAll, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

const originalWorker = globalThis.Worker
const workers: FakeWorker[] = []

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
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

Object.assign(globalThis, {
  window: {},
  Worker: FakeWorker
})

const [{ figFormat }, { IOCancelledError }, { initCodec }] = await Promise.all([
  import('#core/io/formats'),
  import('#core/io/limits'),
  import('#core/kiwi')
])

beforeAll(async () => {
  await initCodec()
})

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Object.assign(globalThis, { Worker: originalWorker })
})

const writeDocument = figFormat.writeDocument
const exportContent = figFormat.exportContent
if (!writeDocument || !exportContent) throw new Error('FIG adapter must support write and export')

test.each([
  [
    'writeDocument',
    (graph: SceneGraph, signal: AbortSignal) => writeDocument(graph, {}, { signal })
  ],
  [
    'exportContent',
    (graph: SceneGraph, signal: AbortSignal) =>
      exportContent({ graph, target: { scope: 'document' } }, {}, { signal })
  ]
])(
  'FIG adapter %s abort terminates thumbnail worker and ignores late settlement',
  async (_, run) => {
    const graph = new SceneGraph()
    const controller = new AbortController()
    const exporting = run(graph, controller.signal)
    while (workers.length === 0) await Bun.sleep(0)
    const worker = workers.shift()

    controller.abort()

    await expect(exporting).rejects.toBeInstanceOf(IOCancelledError)
    expect(worker?.terminated).toBe(true)
    worker?.onmessage?.({
      data: {
        kind: 'fixed-thumbnail',
        width: 400,
        height: 225,
        bytes: new Uint8Array([1])
      }
    } as MessageEvent)
    worker?.onerror?.({ message: 'late worker error' } as ErrorEvent)
    expect(worker?.terminated).toBe(true)
  }
)
