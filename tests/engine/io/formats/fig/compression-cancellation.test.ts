import { afterAll, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

interface WorkerDouble {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  terminated: boolean
}

const originalWorker = globalThis.Worker
let constructorError: Error | undefined
let workers: WorkerDouble[] = []

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  constructor() {
    if (constructorError) throw constructorError
    workers.push(this)
  }

  postMessage() {
    return undefined
  }

  terminate() {
    this.terminated = true
  }
}

Object.assign(globalThis, { window: {}, Worker: FakeWorker })

const [
  { exportFigFile, compressFigData, FigCompressionCancellationUnsupportedError },
  { IOCancelledError },
  { initCodec }
] = await Promise.all([
  import('#core/io/formats/fig/export'),
  import('#core/io/limits'),
  import('#core/kiwi')
])
await initCodec()

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Object.assign(globalThis, { Worker: originalWorker })
})

test('abort after thumbnail settlement terminates compression without fallback', async () => {
  workers = []
  const graph = new SceneGraph()
  const controller = new AbortController()
  const exporting = exportFigFile(graph, undefined, undefined, undefined, false, controller.signal)
  const thumbnailWorker = await waitForWorker(workers)

  thumbnailWorker.onmessage?.({
    data: {
      kind: 'fixed-thumbnail',
      width: 400,
      height: 225,
      bytes: new Uint8Array([1])
    }
  } as MessageEvent)
  const compressionWorker = await waitForWorker(workers)

  controller.abort()

  await expect(exporting).rejects.toBeInstanceOf(IOCancelledError)
  expect(thumbnailWorker.terminated).toBe(true)
  expect(compressionWorker.terminated).toBe(true)
  expect(workers).toHaveLength(0)

  compressionWorker.onmessage?.({ data: new Uint8Array([2]) } as MessageEvent)
  compressionWorker.onerror?.({ message: 'late worker error' } as ErrorEvent)
  expect(compressionWorker.terminated).toBe(true)
  expect(workers).toHaveLength(0)
})

test('compression timeout terminates active worker with typed cancellation', async () => {
  workers = []
  const compression = compressFigData(
    new Uint8Array(),
    new Uint8Array(),
    new Uint8Array(),
    '{}',
    [],
    undefined,
    undefined,
    1
  )
  const worker = await waitForWorker(workers)

  await expect(compression).rejects.toBeInstanceOf(IOCancelledError)
  expect(worker.terminated).toBe(true)
})

test('pre-aborted non-worker compression rejects before synchronous work', async () => {
  const controller = new AbortController()
  controller.abort()
  Object.assign(globalThis, { Worker: undefined })

  try {
    await expect(
      compressFigData(
        new Uint8Array(),
        new Uint8Array(),
        new Uint8Array(),
        '{}',
        [],
        undefined,
        controller.signal
      )
    ).rejects.toBeInstanceOf(IOCancelledError)
  } finally {
    Object.assign(globalThis, { Worker: FakeWorker })
  }
})

test('worker-unavailable compression rejects cancellable work before synchronous fallback', async () => {
  const controller = new AbortController()
  Object.assign(globalThis, { Worker: undefined })

  try {
    await expect(
      compressFigData(
        new Uint8Array(),
        new Uint8Array(),
        new Uint8Array(),
        '{}',
        [],
        undefined,
        controller.signal
      )
    ).rejects.toBeInstanceOf(FigCompressionCancellationUnsupportedError)
  } finally {
    Object.assign(globalThis, { Worker: FakeWorker })
  }
})

test('worker-unavailable compression preserves no-signal synchronous fallback', async () => {
  Object.assign(globalThis, { Worker: undefined })

  try {
    await expect(
      compressFigData(new Uint8Array(), new Uint8Array(), new Uint8Array(), '{}', [])
    ).resolves.toBeInstanceOf(Uint8Array)
  } finally {
    Object.assign(globalThis, { Worker: FakeWorker })
  }
})

test('compression worker failures reject without synchronous fallback', async () => {
  workers = []
  constructorError = new Error('constructor blocked by CSP')
  await expect(compress()).rejects.toThrow('constructor blocked by CSP')
  constructorError = undefined

  const postFailure = compress()
  let worker = await waitForWorker(workers)
  worker.onerror?.({ message: 'compression crashed' } as ErrorEvent)
  await expect(postFailure).rejects.toThrow('compression crashed')
  expect(worker.terminated).toBe(true)

  const protocolFailure = compress()
  worker = await waitForWorker(workers)
  worker.onmessage?.({ data: { invalid: true } } as MessageEvent)
  await expect(protocolFailure).rejects.toHaveProperty('name', 'FigCompressionWorkerProtocolError')
  expect(worker.terminated).toBe(true)
})

function compress(): Promise<Uint8Array> {
  return compressFigData(
    new Uint8Array(),
    new Uint8Array(),
    new Uint8Array(),
    '{}',
    [],
    undefined,
    undefined,
    1_000
  )
}

async function waitForWorker(workers: WorkerDouble[]): Promise<WorkerDouble> {
  const deadline = Date.now() + 1_000
  while (workers.length === 0 && Date.now() < deadline) await Bun.sleep(0)
  const worker = workers.shift()
  if (!worker) throw new Error('FIG worker was not dispatched within 1s')
  return worker
}
