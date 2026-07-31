import { readFile } from 'node:fs/promises'

import { BUILTIN_IO_FORMATS, IORegistry, initCanvasKit } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneGraph } from '@open-pencil/core/scene-graph'

export { initCanvasKit }

const io = new IORegistry(BUILTIN_IO_FORMATS)

export async function loadDocumentBytes(name: string, bytes: Uint8Array): Promise<SceneGraph> {
  const { graph } = await io.readDocument({ name, data: bytes })
  computeAllLayouts(graph)
  return graph
}

export async function loadDocument(filePath: string): Promise<SceneGraph> {
  const bytes = new Uint8Array(await readFile(filePath))
  return loadDocumentBytes(filePath, bytes)
}
