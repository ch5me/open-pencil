import { afterAll, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

interface WorkerDouble {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  terminated: boolean
}

const isolatedCase = Bun.env.FIG_ADAPTER_CANCELLATION_CASE

if (!isolatedCase) {
  test.each(['writeDocument', 'exportContent'])(
    'FIG adapter %s abort terminates thumbnail worker and ignores late settlement',
    async (name) => {
      const subprocess = Bun.spawn([process.execPath, 'test', import.meta.path], {
        env: { ...Bun.env, FIG_ADAPTER_CANCELLATION_CASE: name },
        stderr: 'pipe',
        stdout: 'pipe'
      })
      const timeout = setTimeout(() => subprocess.kill(), 5_000)
      const [exitCode, stdout, stderr] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text()
      ])
      clearTimeout(timeout)

      if (exitCode !== 0) {
        throw new Error(`isolated cancellation test failed (${exitCode})\n${stdout}${stderr}`)
      }
    },
    10_000
  )
} else {
  const originalWorker = globalThis.Worker
  const workers: WorkerDouble[] = []

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
  await initCodec()

  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'window')
    Object.assign(globalThis, { Worker: originalWorker })
  })

  const writeDocument = figFormat.writeDocument
  const exportContent = figFormat.exportContent
  if (!writeDocument || !exportContent) throw new Error('FIG adapter must support write and export')

  if (isolatedCase !== 'writeDocument' && isolatedCase !== 'exportContent') {
    throw new Error(`unknown cancellation case: ${isolatedCase}`)
  }
  const run = (graph: SceneGraph, signal: AbortSignal) =>
    isolatedCase === 'writeDocument'
      ? writeDocument(graph, {}, { signal })
      : exportContent({ graph, target: { scope: 'document' } }, {}, { signal })

  test(`isolated ${isolatedCase} cancellation`, async () => {
    const graph = new SceneGraph()
    const controller = new AbortController()
    const exporting = run(graph, controller.signal)
    const worker = await waitForWorker(workers)

    controller.abort()

    await expect(exporting).rejects.toBeInstanceOf(IOCancelledError)
    expect(worker.terminated).toBe(true)
    expect(worker.onmessage).not.toBeNull()
    expect(worker.onerror).not.toBeNull()
    worker.onmessage?.({
      data: {
        kind: 'fixed-thumbnail',
        width: 400,
        height: 225,
        bytes: new Uint8Array([1])
      }
    } as MessageEvent)
    worker.onerror?.({ message: 'late worker error' } as ErrorEvent)
    expect(worker.terminated).toBe(true)
  }, 3_000)
}

async function waitForWorker(workers: WorkerDouble[]): Promise<WorkerDouble> {
  const deadline = Date.now() + 1_000
  while (workers.length === 0 && Date.now() < deadline) await Bun.sleep(0)
  const worker = workers.shift()
  if (!worker) throw new Error('thumbnail worker was not dispatched within 1s')
  return worker
}
