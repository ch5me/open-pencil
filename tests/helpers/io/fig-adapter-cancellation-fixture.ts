import { SceneGraph } from '@open-pencil/scene-graph'

type Operation = 'writeDocument' | 'exportContent'

const operation = process.argv[2] as Operation | undefined
if (operation !== 'writeDocument' && operation !== 'exportContent') {
  throw new Error(`Unsupported FIG adapter operation: ${operation ?? 'missing'}`)
}

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
await initCodec()

const graph = new SceneGraph()
graph.addPage('Page 1')
const controller = new AbortController()
const exporting =
  operation === 'writeDocument'
    ? figFormat.writeDocument?.(graph, {}, { signal: controller.signal })
    : figFormat.exportContent?.(
        { graph, target: { scope: 'document' } },
        {},
        { signal: controller.signal }
      )
if (!exporting) throw new Error(`FIG adapter does not support ${operation}`)

while (workers.length === 0) await Bun.sleep(0)
const worker = workers.shift()
if (!worker) throw new Error('FIG adapter did not start the thumbnail worker')

controller.abort()

let cancelled = false
try {
  await exporting
} catch (error) {
  cancelled = error instanceof IOCancelledError
}

worker.onmessage?.({
  data: {
    kind: 'fixed-thumbnail',
    width: 400,
    height: 225,
    bytes: new Uint8Array([1])
  }
} as MessageEvent)
worker.onerror?.({ message: 'late worker error' } as ErrorEvent)

process.stdout.write(
  JSON.stringify({
    cancelled,
    terminated: worker.terminated,
    lateSettlementIgnored: worker.terminated
  })
)
