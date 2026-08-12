import { parseFigBuffer } from '@open-pencil/fig'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { IS_BROWSER } from '#core/constants'
import {
  assertDecodedWithinLimits,
  assertZipDecodedWithinLimits,
  IOCancelledError,
  throwIfIOCancelled
} from '#core/io/limits'
import { assertInputWithinLimit } from '#core/io/registry'
import { importNodeChanges } from '#core/kiwi/fig/import'
import { deserializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import type { SerializedSceneGraph } from '#core/kiwi/fig/parse/transfer'

export interface ParseFigFileOptions {
  populate?: 'all' | 'first-page'
  maxInputBytes?: number
  maxDecodedBytes?: number
  maxExpansionRatio?: number
  signal?: AbortSignal
}

function parseFigFileSync(buffer: ArrayBuffer, options: ParseFigFileOptions = {}): SceneGraph {
  throwIfIOCancelled(options.signal)
  assertDecodedWithinLimits(buffer.byteLength, buffer.byteLength, options)
  assertZipDecodedWithinLimits(new Uint8Array(buffer), options)
  const {
    nodeChanges,
    blobs,
    images: imageEntries,
    figKiwiVersion,
    figSchemaDeflated
  } = parseFigBuffer(buffer)
  const graph = importNodeChanges(nodeChanges, blobs, new Map(imageEntries), options)
  graph.figKiwiVersion = figKiwiVersion
  graph.figSchemaDeflated = figSchemaDeflated
  throwIfIOCancelled(options.signal)
  return graph
}

interface WorkerParseResult {
  graph?: SerializedSceneGraph
  error?: string
}

export function parseFigViaWorker(
  buffer: ArrayBuffer,
  options: ParseFigFileOptions
): Promise<SceneGraph> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../../kiwi/fig/parse/worker.ts', import.meta.url), {
      type: 'module'
    })
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', cancel)
      worker.terminate()
      callback()
    }
    const cancel = () => {
      finish(() => reject(new IOCancelledError('IO import cancelled')))
    }

    worker.onmessage = (e: MessageEvent<WorkerParseResult>) => {
      finish(() => {
        if (options.signal?.aborted) {
          reject(new IOCancelledError('IO import cancelled'))
        } else if (e.data.error || !e.data.graph) {
          reject(new Error(e.data.error ?? 'Worker failed to parse .fig file'))
        } else {
          resolve(deserializeSceneGraph(e.data.graph))
        }
      })
    }

    worker.onerror = (err) => {
      finish(() => reject(new Error(err.message || 'Worker failed to parse .fig file')))
    }

    const workerOptions = {
      populate: options.populate,
      maxInputBytes: options.maxInputBytes,
      maxDecodedBytes: options.maxDecodedBytes,
      maxExpansionRatio: options.maxExpansionRatio
    }
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) {
      cancel()
      return
    }
    try {
      worker.postMessage({ buffer, options: workerOptions }, [buffer])
    } catch (error) {
      const cause = error instanceof Error ? error : new Error('Worker failed to receive .fig data')
      finish(() => reject(cause))
    }
  })
}

export async function parseFigFile(
  buffer: ArrayBuffer,
  options: ParseFigFileOptions = {}
): Promise<SceneGraph> {
  throwIfIOCancelled(options.signal)
  assertInputWithinLimit(buffer.byteLength, options.maxInputBytes)
  assertDecodedWithinLimits(buffer.byteLength, buffer.byteLength, options)
  assertZipDecodedWithinLimits(new Uint8Array(buffer), options)
  if (typeof Worker !== 'undefined' && IS_BROWSER) {
    const copy = buffer.slice(0)
    try {
      return await parseFigViaWorker(buffer, options)
    } catch (error) {
      throwIfIOCancelled(options.signal)
      console.warn('Worker parsing failed, falling back to main thread:', error)
      return parseFigFileSync(copy, options)
    }
  }
  return parseFigFileSync(buffer, options)
}

export async function readFigFile(
  file: File,
  options: ParseFigFileOptions = {}
): Promise<SceneGraph> {
  throwIfIOCancelled(options.signal)
  assertInputWithinLimit(file.size, options.maxInputBytes)
  return parseFigFile(await file.arrayBuffer(), options)
}
