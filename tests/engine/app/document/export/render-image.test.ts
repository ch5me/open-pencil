import { expect, test } from 'bun:test'

import type { Editor, EditorState } from '@open-pencil/core/editor'
import type { IORegistry } from '@open-pencil/core/io'
import { IOCancelledError } from '@open-pencil/core/io/limits'
import { SceneGraph } from '@open-pencil/scene-graph'

import { handleExport } from '@/app/automation/bridge/export-handlers'
import { createExportTargetActions, EXPORT_IMAGE_TIMEOUT_MS } from '@/app/document/export/files'

test('browser renderExportImage routes exact request through abortable raster worker', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('RECTANGLE', page.id, { width: 10, height: 10 })
  const controller = new AbortController()
  const output = new Uint8Array([1, 2, 3])
  let request:
    | {
        pageId: string
        nodeIds: string[]
        options: unknown
        signal?: AbortSignal
        timeoutMs: number
      }
    | undefined
  const editor = Object.create(null) as Editor
  Object.defineProperties(editor, {
    graph: { value: graph },
    renderer: { value: { ck: {}, canvas: {} } }
  })
  const state = { currentPageId: page.id } as EditorState
  const actions = createExportTargetActions(editor, state, {} as IORegistry, {
    available: () => true,
    render: async (_graph, pageId, nodeIds, options, signal, timeoutMs) => {
      request = { pageId, nodeIds, options, signal, timeoutMs }
      return output
    }
  })

  await expect(
    actions.renderExportImage([node.id], 2, 'PNG', page.id, controller.signal)
  ).resolves.toBe(output)
  expect(request).toEqual({
    pageId: page.id,
    nodeIds: [node.id],
    options: { scale: 2, format: 'PNG' },
    signal: controller.signal,
    timeoutMs: EXPORT_IMAGE_TIMEOUT_MS
  })
})

test('automation export supplies a 60s caller deadline and preserves typed cancellation', async () => {
  let signal: AbortSignal | undefined
  const target = {
    store: {
      state: { selectedIds: new Set(['node']) },
      renderExportImage: async (
        _nodeIds: string[],
        _scale: number,
        _format: string,
        _pageId?: string,
        callerSignal?: AbortSignal
      ) => {
        signal = callerSignal
        throw new IOCancelledError('IO export cancelled')
      }
    }
  }

  await expect(handleExport(target as never, undefined)).rejects.toBeInstanceOf(IOCancelledError)
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(signal?.aborted).toBe(false)
})
