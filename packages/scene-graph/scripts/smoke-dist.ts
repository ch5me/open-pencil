export {}

const mod = await import('../dist/index.js')
const history = await import('../dist/chunks/history.js')
const idAllocation = await import('../dist/chunks/id-allocation.js')
const variables = await import('../dist/variables.js')

const graph = new mod.SceneGraph()
const page = graph.getPages()[0]
const node = graph.createNode('RECTANGLE', page.id, { width: 10, height: 20 })

if (graph.getNode(node.id)?.width !== 10) {
  throw new Error('Expected built SceneGraph package to create nodes')
}

const state = history.createHistoryState()
if (state.version !== 'open-pencil-history:1') {
  throw new Error('Expected built history subpath')
}

const allocator = idAllocation.deriveSceneGraphIdAllocatorState(graph)
if (allocator.version !== 'open-pencil-id-allocation:1') {
  throw new Error('Expected built ID allocation subpath')
}

if (typeof variables.createVariable !== 'function') {
  throw new Error('Expected built variables subpath')
}
