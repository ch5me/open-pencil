import type { SceneGraph } from '@open-pencil/scene-graph'

import { IS_BROWSER } from '#core/constants'
import { IOCancelledError, throwIfIOCancelled } from '#core/io/limits'
import { serializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import { fontManager } from '#core/text/fonts'

import type {
  FixedThumbnailWorkerRequest,
  RasterExportWorkerRequest,
  RasterWorkerOptions,
  RasterWorkerRequest,
  RasterWorkerResponse
} from './worker-protocol'

const RASTER_EXPORT_TIMEOUT_MS = 60_000

export type { RasterWorkerOptions } from './worker-protocol'

export class RasterWorkerFontUnavailableError extends Error {
  override name = 'RasterWorkerFontUnavailableError'
}

export class RasterWorkerProtocolError extends Error {
  override name = 'RasterWorkerProtocolError'
}

interface RasterWorkerResponseCandidate {
  kind?: unknown
  bytes?: unknown
  error?: unknown
  width?: unknown
  height?: unknown
}

function isRasterWorkerResponse(value: unknown): value is RasterWorkerResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as RasterWorkerResponseCandidate
  if (response.kind !== 'raster' && response.kind !== 'fixed-thumbnail') return false
  if (response.bytes !== undefined && !(response.bytes instanceof Uint8Array)) return false
  if (response.error !== undefined && typeof response.error !== 'string') return false
  if (response.bytes !== undefined && response.error !== undefined) return false
  if (response.kind === 'fixed-thumbnail') {
    return typeof response.width === 'number' && typeof response.height === 'number'
  }
  return true
}

export function canUseRasterExportWorker(): boolean {
  return IS_BROWSER && typeof Worker !== 'undefined'
}

function waitForAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new IOCancelledError('IO export cancelled'))
  let rejectAbort: (error: IOCancelledError) => void = () => undefined
  const cancel = () => rejectAbort(new IOCancelledError('IO export cancelled'))
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  signal.addEventListener('abort', cancel, { once: true })
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', cancel))
}

function canvasKitWASMURL(): string {
  if (typeof location !== 'undefined') {
    const base = 'env' in import.meta ? import.meta.env.BASE_URL : '/'
    const prefix = base === '/' ? '' : base.replace(/\/$/, '')
    return new URL(`${prefix}/canvaskit.wasm`, location.origin).href
  }
  const ckPath = import.meta.resolve('canvaskit-wasm')
  return new URL('canvaskit.wasm', ckPath).href
}

function workerNodeIds(
  graph: SceneGraph,
  request: Pick<RasterExportWorkerRequest, 'kind' | 'pageId'> & { nodeIds?: string[] }
): string[] {
  if (request.kind === 'raster') return request.nodeIds ?? []
  return graph.getNode(request.pageId)?.childIds ?? []
}

async function dispatchRasterWorker(
  graph: SceneGraph,
  requestInfo: Pick<RasterExportWorkerRequest, 'kind' | 'pageId'> & { nodeIds?: string[] },
  createRequest: (
    graph: ReturnType<typeof serializeSceneGraph>,
    fontSnapshot: Awaited<ReturnType<typeof fontManager.createExportSnapshot>>
  ) => RasterExportWorkerRequest,
  signal?: AbortSignal,
  timeoutMs = RASTER_EXPORT_TIMEOUT_MS
): Promise<RasterWorkerResponse> {
  throwIfIOCancelled(signal)
  const exportController = new AbortController()
  const cancel = () => exportController.abort()
  const deadlineTimer = setTimeout(cancel, timeoutMs)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const exportSignal = exportController.signal

  try {
    const nodeIds = workerNodeIds(graph, requestInfo)
    const fontSnapshot = await waitForAbortable(
      fontManager.createExportSnapshot(graph, nodeIds, exportSignal),
      exportSignal
    )
    const requiredKeys = fontManager.collectFontKeys(graph, nodeIds)
    const requiredFallbacks = fontManager.collectFallbackScripts(graph, nodeIds)
    const loaded = new Set(fontSnapshot.fonts.map(({ family, style }) => `${family}\0${style}`))
    const missing = requiredKeys
      .filter(([family, style]) => !loaded.has(`${family}\0${style}`))
      .map(([family, style]) => `"${family}" ${style}`)
      .concat(
        requiredFallbacks.flatMap((script) =>
          fontSnapshot.fallbackFamilies[script].length === 0
            ? [`${script} fallback`]
            : fontSnapshot.fallbackFamilies[script]
                .filter((family) => !loaded.has(`${family}\0Regular`))
                .map((family) => `"${family}" Regular`)
        )
      )
    if (missing.length > 0) {
      throw new RasterWorkerFontUnavailableError(
        `Abortable raster export requires loaded font bytes: ${missing.join(', ')}`
      )
    }
    throwIfIOCancelled(exportSignal)

    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      let settled = false

      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        exportSignal.removeEventListener('abort', cancelWorker)
        worker.terminate()
        callback()
      }
      const cancelWorker = () => finish(() => reject(new IOCancelledError('IO export cancelled')))

      worker.onmessage = (event: MessageEvent<unknown>) => {
        const response = event.data
        if (!isRasterWorkerResponse(response)) {
          finish(() => reject(new RasterWorkerProtocolError('Raster worker returned invalid data')))
          return
        }
        finish(() => {
          if (exportSignal.aborted) {
            reject(new IOCancelledError('IO export cancelled'))
          } else if (response.error) {
            reject(new Error(response.error))
          } else {
            resolve(response)
          }
        })
      }
      worker.onerror = (event) => {
        finish(() => reject(new Error(event.message || 'Raster export worker failed')))
      }

      exportSignal.addEventListener('abort', cancelWorker, { once: true })
      if (exportSignal.aborted) {
        cancelWorker()
        return
      }

      try {
        const serialized = serializeSceneGraph(graph)
        throwIfIOCancelled(exportSignal)
        const request = createRequest(serialized, fontSnapshot)
        // Structured clone preserves caller-owned image, document, and font buffers.
        worker.postMessage(request, [])
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))))
      }
    })
  } finally {
    clearTimeout(deadlineTimer)
    signal?.removeEventListener('abort', cancel)
  }
}

export async function renderRasterViaWorker(
  graph: SceneGraph,
  pageId: string,
  nodeIds: string[],
  options: RasterWorkerOptions,
  signal?: AbortSignal,
  timeoutMs = RASTER_EXPORT_TIMEOUT_MS
): Promise<Uint8Array | null> {
  const response = await dispatchRasterWorker(
    graph,
    { kind: 'raster', pageId, nodeIds },
    (serialized, fontSnapshot): RasterWorkerRequest => ({
      kind: 'raster',
      graph: serialized,
      pageId,
      nodeIds: [...nodeIds],
      options,
      canvasKitWASMURL: canvasKitWASMURL(),
      fontSnapshot
    }),
    signal,
    timeoutMs
  )
  if (response.kind !== 'raster') {
    throw new RasterWorkerProtocolError(`Expected raster result, received ${response.kind}`)
  }
  return response.bytes instanceof Uint8Array ? response.bytes : null
}

export async function renderFixedThumbnailViaWorker(
  graph: SceneGraph,
  pageId: string,
  width: number,
  height: number,
  signal?: AbortSignal,
  timeoutMs = RASTER_EXPORT_TIMEOUT_MS
): Promise<Uint8Array | null> {
  const response = await dispatchRasterWorker(
    graph,
    { kind: 'fixed-thumbnail', pageId },
    (serialized, fontSnapshot): FixedThumbnailWorkerRequest => ({
      kind: 'fixed-thumbnail',
      graph: serialized,
      pageId,
      width,
      height,
      canvasKitWASMURL: canvasKitWASMURL(),
      fontSnapshot
    }),
    signal,
    timeoutMs
  )
  if (
    response.kind !== 'fixed-thumbnail' ||
    response.width !== width ||
    response.height !== height
  ) {
    throw new RasterWorkerProtocolError('Fixed-thumbnail worker returned mismatched dimensions')
  }
  return response.bytes instanceof Uint8Array ? response.bytes : null
}
