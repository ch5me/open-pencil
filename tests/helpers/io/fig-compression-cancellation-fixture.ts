import { SceneGraph } from '@open-pencil/scene-graph'

interface WorkerDouble {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  terminated: boolean
}

type Operation =
  | 'abort-after-thumbnail'
  | 'timeout'
  | 'pre-aborted-without-worker'
  | 'cancellable-without-worker'
  | 'fallback-without-worker'
  | 'worker-failures'

const operation = process.argv[2] as Operation | undefined
const workers: WorkerDouble[] = []
let constructorError: Error | undefined

class FakeWorker implements WorkerDouble {
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

switch (operation) {
  case 'abort-after-thumbnail': {
    const graph = new SceneGraph()
    const controller = new AbortController()
    const exporting = exportFigFile(
      graph,
      undefined,
      undefined,
      undefined,
      false,
      controller.signal
    )
    const thumbnailWorker = await waitForWorker()

    thumbnailWorker.onmessage?.({
      data: {
        kind: 'fixed-thumbnail',
        width: 400,
        height: 225,
        bytes: new Uint8Array([1])
      }
    } as MessageEvent)
    const compressionWorker = await waitForWorker()
    controller.abort()

    const error = await rejectionOf(exporting)
    compressionWorker.onmessage?.({ data: new Uint8Array([2]) } as MessageEvent)
    compressionWorker.onerror?.({ message: 'late worker error' } as ErrorEvent)
    writeResult({
      cancelled: error instanceof IOCancelledError,
      thumbnailTerminated: thumbnailWorker.terminated,
      compressionTerminated: compressionWorker.terminated,
      pendingWorkers: workers.length
    })
    break
  }
  case 'timeout': {
    const compression = compress(1)
    const worker = await waitForWorker()
    const error = await rejectionOf(compression)
    writeResult({ cancelled: error instanceof IOCancelledError, terminated: worker.terminated })
    break
  }
  case 'pre-aborted-without-worker': {
    const controller = new AbortController()
    controller.abort()
    Object.assign(globalThis, { Worker: undefined })
    const error = await rejectionOf(compress(undefined, controller.signal))
    writeResult({ cancelled: error instanceof IOCancelledError })
    break
  }
  case 'cancellable-without-worker': {
    const controller = new AbortController()
    Object.assign(globalThis, { Worker: undefined })
    const error = await rejectionOf(compress(undefined, controller.signal))
    writeResult({
      unsupported: error instanceof FigCompressionCancellationUnsupportedError
    })
    break
  }
  case 'fallback-without-worker': {
    Object.assign(globalThis, { Worker: undefined })
    writeResult({ compressed: (await compress()) instanceof Uint8Array })
    break
  }
  case 'worker-failures': {
    constructorError = new Error('constructor blocked by CSP')
    const constructorFailure = await rejectionOf(compress())
    constructorError = undefined

    const postFailure = compress()
    let worker = await waitForWorker()
    worker.onerror?.({ message: 'compression crashed' } as ErrorEvent)
    const postError = await rejectionOf(postFailure)
    const postTerminated = worker.terminated

    const protocolFailure = compress()
    worker = await waitForWorker()
    worker.onmessage?.({ data: { invalid: true } } as MessageEvent)
    const protocolError = await rejectionOf(protocolFailure)
    writeResult({
      constructorMessage: errorMessage(constructorFailure),
      postMessage: errorMessage(postError),
      postTerminated,
      protocolName: errorName(protocolError),
      protocolTerminated: worker.terminated
    })
    break
  }
  default:
    throw new Error(`Unsupported FIG compression operation: ${operation ?? 'missing'}`)
}

function compress(timeoutMs = 1_000, signal?: AbortSignal): Promise<Uint8Array> {
  return compressFigData(
    new Uint8Array(),
    new Uint8Array(),
    new Uint8Array(),
    '{}',
    [],
    undefined,
    signal,
    timeoutMs
  )
}

async function waitForWorker(): Promise<WorkerDouble> {
  const deadline = Date.now() + 1_000
  while (workers.length === 0 && Date.now() < deadline) await Bun.sleep(0)
  const worker = workers.shift()
  if (!worker) throw new Error('FIG worker was not dispatched within 1s')
  return worker
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected FIG compression operation to reject')
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined
}

function writeResult(result: object): void {
  process.stdout.write(`\n__FIG_COMPRESSION_RESULT__${JSON.stringify(result)}\n`)
}
