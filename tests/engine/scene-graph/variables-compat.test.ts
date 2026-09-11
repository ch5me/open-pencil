import { describe, expect, test } from 'bun:test'

import { SceneGraph, SceneGraphIdAllocationError } from '@open-pencil/scene-graph'
import { createCollection, createVariable } from '@open-pencil/scene-graph/variables'

describe('public variable helper compatibility', () => {
  test('retains supplied generator signatures and reserves IDs atomically', () => {
    const graph = new SceneGraph()
    const generated = ['external:collection', 'external:mode']
    const collection = createCollection(graph, () => generated.shift()!, 'Tokens')
    expect(collection.id).toBe('external:collection')

    const variable = createVariable(
      graph,
      () => 'external:variable',
      'Spacing',
      'FLOAT',
      collection.id,
      8
    )
    expect(variable.id).toBe('external:variable')
  })

  test('duplicate generated collection IDs fail before any mutation', () => {
    const graph = new SceneGraph()
    const collectionCount = graph.variableCollections.size
    const activeModeCount = graph.activeMode.size

    expect(() => createCollection(graph, () => 'duplicate', 'Broken')).toThrow(
      SceneGraphIdAllocationError
    )
    expect(graph.variableCollections.size).toBe(collectionCount)
    expect(graph.activeMode.size).toBe(activeModeCount)
  })
})
