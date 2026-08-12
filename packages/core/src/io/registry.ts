import type { SceneGraph } from '@open-pencil/scene-graph'

import { throwIfIOCancelled } from './limits'
import type { ExportRequest, IOContext, IOFormatAdapter, ReadDocumentInput } from './types'

export class IOInputLimitError extends Error {
  readonly code = 'io-input-limit'
}

export function assertInputWithinLimit(byteLength: number, maxInputBytes?: number): void {
  if (maxInputBytes === undefined) return
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 0) {
    throw new IOInputLimitError('maxInputBytes must be a non-negative safe integer')
  }
  if (byteLength > maxInputBytes) {
    throw new IOInputLimitError(`input exceeds maxInputBytes: ${byteLength} > ${maxInputBytes}`)
  }
}

export class IORegistry {
  constructor(private readonly adapters: IOFormatAdapter[]) {}

  listFormats(): IOFormatAdapter[] {
    return this.adapters
  }

  getFormat(id: string): IOFormatAdapter | null {
    return this.adapters.find((adapter) => adapter.id === id) ?? null
  }

  listReadableFormats(): IOFormatAdapter[] {
    return this.adapters.filter((adapter) => adapter.support.readDocument)
  }

  listWritableFormats(): IOFormatAdapter[] {
    return this.adapters.filter((adapter) => adapter.support.writeDocument)
  }

  listExportFormats(scope: ExportRequest['target']['scope']): IOFormatAdapter[] {
    return this.adapters.filter((adapter) => {
      switch (scope) {
        case 'document':
          return !!adapter.support.exportDocument
        case 'page':
          return !!adapter.support.exportPage
        case 'selection':
          return !!adapter.support.exportSelection
        case 'node':
          return !!adapter.support.exportNode
        default:
          return false
      }
    })
  }

  findReader(fileName: string, mimeType?: string): IOFormatAdapter | null {
    return (
      this.adapters.find((adapter) => {
        if (!adapter.support.readDocument) return false
        if (adapter.matchesFile) return adapter.matchesFile(fileName, mimeType)
        const lower = fileName.toLowerCase()
        return adapter.extensions.some((ext) => lower.endsWith(`.${ext}`))
      }) ?? null
    )
  }

  async readDocument(input: ReadDocumentInput, context?: IOContext) {
    throwIfIOCancelled(context?.signal)
    assertInputWithinLimit(input.data.byteLength, context?.maxInputBytes)
    const reader = this.findReader(input.name ?? '', input.mimeType)
    if (!reader?.readDocument) {
      throw new Error(`Unsupported document format: ${input.name ?? 'unknown'}`)
    }
    const result = await reader.readDocument(input, context)
    throwIfIOCancelled(context?.signal)
    return result
  }

  async writeDocument(formatId: string, graph: SceneGraph, options?: unknown, context?: IOContext) {
    const adapter = this.getFormat(formatId)
    if (!adapter?.writeDocument) {
      throw new Error(`Format does not support writeDocument: ${formatId}`)
    }
    return adapter.writeDocument(graph, options, context)
  }

  async exportContent(
    formatId: string,
    request: ExportRequest,
    options?: unknown,
    context?: IOContext
  ) {
    const adapter = this.getFormat(formatId)
    if (!adapter?.exportContent) {
      throw new Error(`Format does not support exportContent: ${formatId}`)
    }
    return adapter.exportContent(request, options, context)
  }
}
