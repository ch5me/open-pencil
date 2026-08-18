import { describe, expect, test } from 'bun:test'

import {
  deriveSceneGraphIdAllocatorState,
  generateId,
  SceneGraph,
  SceneGraphIdAllocationError,
  type SceneGraphHydrationSnapshotV1
} from '@open-pencil/scene-graph'

function snapshot(graph: SceneGraph): SceneGraphHydrationSnapshotV1 {
  return {
    rootId: graph.rootId,
    nodes: graph.nodes,
    images: graph.images,
    variables: graph.variables,
    variableCollections: graph.variableCollections,
    activeMode: graph.activeMode,
    figKiwiVersion: graph.figKiwiVersion,
    figSchemaDeflated: graph.figSchemaDeflated,
    documentColorSpace: graph.documentColorSpace
  }
}

describe('SceneGraph ID allocation and hydration', () => {
  test('hydrates without consuming global IDs or creating default entities', () => {
    const source = new SceneGraph()
    const page = source.getPages()[0]
    source.createNodeWithId('0:40', 'RECTANGLE', page.id, { name: 'Imported' })
    const state = deriveSceneGraphIdAllocatorState(source)
    const before = Number(generateId().slice(2))

    const hydrated = SceneGraph.hydrate(snapshot(source), state)
    const after = Number(generateId().slice(2))

    expect(after).toBe(before + 1)
    expect(hydrated.nodes.size).toBe(source.nodes.size)
    expect(hydrated.getPages()).toHaveLength(1)
    expect(hydrated.createNode('RECTANGLE', hydrated.getPages()[0].id).id).toBe('0:41')
  })

  test('defensively copies hydrated bytes and graph records', () => {
    const source = new SceneGraph()
    source.images.set('image', new Uint8Array([1, 2, 3]))
    const hydrated = SceneGraph.hydrate(
      snapshot(source),
      deriveSceneGraphIdAllocatorState(source)
    )

    source.images.get('image')![0] = 9
    source.nodes.get(source.rootId)!.name = 'Changed'
    expect(hydrated.images.get('image')).toEqual(new Uint8Array([1, 2, 3]))
    expect(hydrated.nodes.get(hydrated.rootId)?.name).toBe('Document')
  })

  test('rejects cross-domain explicit ID collisions without mutation', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Tokens')
    const before = graph.nodes.size

    expect(() =>
      graph.createNodeWithId(collection.id, 'RECTANGLE', graph.getPages()[0].id)
    ).toThrow(SceneGraphIdAllocationError)
    expect(graph.nodes.size).toBe(before)
  })
})
