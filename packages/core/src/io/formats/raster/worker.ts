import CanvasKitInit from 'canvaskit-wasm'

import { SkiaRenderer } from '#core/canvas'
import { deserializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import { fontManager } from '#core/text/fonts'

import { renderNodesToRaster, renderThumbnail } from './render'
import type { RasterExportWorkerRequest, RasterWorkerResponse } from './worker-protocol'

type WorkerScope = typeof self & {
  postMessage(message: unknown, transfer: Transferable[]): void
}

function postResponse(response: RasterWorkerResponse): void {
  const transfer = response.bytes?.buffer instanceof ArrayBuffer ? [response.bytes.buffer] : []
  ;(self as WorkerScope).postMessage(response, transfer)
}

async function encodeFallback(
  fallback: NonNullable<ReturnType<typeof renderNodesToRaster>>['fallback']
): Promise<Uint8Array> {
  if (!fallback) throw new TypeError('Raster worker fallback missing')
  if (typeof OffscreenCanvas === 'undefined') {
    throw new TypeError(`Raster worker cannot encode ${fallback.format}`)
  }
  const canvas = new OffscreenCanvas(fallback.width, fallback.height)
  const context = canvas.getContext('2d')
  if (!context) throw new TypeError('Raster worker could not create encoding canvas')
  const image = new ImageData(
    new Uint8ClampedArray(fallback.pixels),
    fallback.width,
    fallback.height
  )
  context.putImageData(image, 0, 0)
  const mimeType =
    fallback.format === 'JPG' ? 'image/jpeg' : `image/${fallback.format.toLowerCase()}`
  const blob = await canvas.convertToBlob({
    type: mimeType,
    quality: fallback.quality / 100
  })
  if (blob.type !== mimeType) throw new Error(`Raster worker cannot encode ${mimeType}`)
  return new Uint8Array(await blob.arrayBuffer())
}

self.onmessage = async (event: MessageEvent<RasterExportWorkerRequest>) => {
  let phase = 'initialize'
  const request = event.data
  try {
    const { graph: serialized, pageId, canvasKitWASMURL, fontSnapshot } = request
    const ck = await CanvasKitInit({ locateFile: () => canvasKitWASMURL })
    phase = 'create-surface'
    const surface = ck.MakeSurface(1, 1)
    if (!surface) throw new Error('Failed to create CanvasKit surface')
    const renderer = new SkiaRenderer(ck, surface)
    phase = 'load-fonts'
    renderer.viewportWidth = 1
    renderer.viewportHeight = 1
    renderer.dpr = 1
    const graph = deserializeSceneGraph(serialized)
    fontManager.applyExportSnapshot(fontSnapshot)
    await renderer.loadFonts(undefined, false, false)
    renderer.invalidateAllPictures()
    const nodeIds =
      request.kind === 'raster' ? request.nodeIds : (graph.getNode(pageId)?.childIds ?? [])
    const restoreTextMeasurer = await renderer.prepareForExport(graph, pageId, nodeIds)
    phase = 'render'
    try {
      if (request.kind === 'fixed-thumbnail') {
        const bytes = renderThumbnail(ck, renderer, graph, pageId, request.width, request.height)
        const response: RasterWorkerResponse = {
          kind: 'fixed-thumbnail',
          width: request.width,
          height: request.height,
          bytes: bytes ?? undefined
        }
        postResponse(response)
        return
      }

      const result = renderNodesToRaster(ck, renderer, graph, pageId, nodeIds, {
        scale: request.options.scale ?? 1,
        format: request.options.format ?? 'PNG',
        quality: request.options.quality,
        trimTransparent: request.options.trimTransparent
      })
      let bytes = result?.bytes ?? null
      if (!bytes && result?.fallback) bytes = await encodeFallback(result.fallback)

      const response: RasterWorkerResponse = { kind: 'raster', bytes: bytes ?? undefined }
      postResponse(response)
    } finally {
      restoreTextMeasurer()
      renderer.destroy()
    }
  } catch (error) {
    const response: RasterWorkerResponse =
      request.kind === 'fixed-thumbnail'
        ? {
            kind: 'fixed-thumbnail',
            width: request.width,
            height: request.height,
            error: `${phase}: ${error instanceof Error ? error.message : String(error)}`
          }
        : {
            kind: 'raster',
            error: `${phase}: ${error instanceof Error ? error.message : String(error)}`
          }
    ;(self as WorkerScope).postMessage(response, [])
  }
}
