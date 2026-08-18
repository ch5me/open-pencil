import type { SceneNode, Variable, VariableCollection } from './types'

const LOCAL_ID_PATTERN = /^0:(0|[1-9][0-9]*)$/
const MAX_ID_FLOOR = Number.MAX_SAFE_INTEGER

export type SceneGraphIdAllocationErrorCode =
  | 'E_GRAPH_ID_COLLISION'
  | 'E_GRAPH_ID_FLOOR_INVALID'
  | 'E_GRAPH_ID_SPACE_EXHAUSTED'

export class SceneGraphIdAllocationError extends Error {
  constructor(
    readonly code: SceneGraphIdAllocationErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'SceneGraphIdAllocationError'
  }
}

export interface SceneGraphIdAllocatorStateV1 {
  readonly version: 'open-pencil-id-allocation:1'
  readonly nextIdFloor: number
}

export interface SceneGraphIdDomain {
  readonly nodes: ReadonlyMap<string, SceneNode>
  readonly variables: ReadonlyMap<string, Variable>
  readonly variableCollections: ReadonlyMap<string, VariableCollection>
  readonly activeMode: ReadonlyMap<string, string>
}

function localIdNumber(id: string): number | null {
  const match = LOCAL_ID_PATTERN.exec(id)
  if (!match) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : null
}

export function collectSceneGraphEntityIds(graph: SceneGraphIdDomain): Set<string> {
  const ids = new Set<string>()
  const add = (id: string): void => {
    if (ids.has(id)) {
      throw new SceneGraphIdAllocationError(
        'E_GRAPH_ID_COLLISION',
        `Duplicate SceneGraph entity ID "${id}"`
      )
    }
    ids.add(id)
  }

  for (const id of graph.nodes.keys()) add(id)
  for (const id of graph.variables.keys()) add(id)
  for (const collection of graph.variableCollections.values()) {
    add(collection.id)
    for (const mode of collection.modes) add(mode.modeId)
  }
  return ids
}

export function deriveSceneGraphIdAllocatorState(
  graph: SceneGraphIdDomain
): SceneGraphIdAllocatorStateV1 {
  let max = 0
  for (const id of collectSceneGraphEntityIds(graph)) {
    const value = localIdNumber(id)
    if (value !== null) max = Math.max(max, value)
  }
  if (max >= MAX_ID_FLOOR) {
    throw new SceneGraphIdAllocationError(
      'E_GRAPH_ID_SPACE_EXHAUSTED',
      'SceneGraph local ID space is exhausted'
    )
  }
  return { version: 'open-pencil-id-allocation:1', nextIdFloor: Math.max(1, max + 1) }
}

export function validateSceneGraphIdAllocatorState(
  graph: SceneGraphIdDomain,
  state: SceneGraphIdAllocatorStateV1
): void {
  if (
    state.version !== 'open-pencil-id-allocation:1' ||
    !Number.isSafeInteger(state.nextIdFloor) ||
    state.nextIdFloor < 1 ||
    state.nextIdFloor > MAX_ID_FLOOR
  ) {
    throw new SceneGraphIdAllocationError(
      'E_GRAPH_ID_FLOOR_INVALID',
      `Invalid SceneGraph next ID floor "${state.nextIdFloor}"`
    )
  }
  const derived = deriveSceneGraphIdAllocatorState(graph)
  if (state.nextIdFloor !== derived.nextIdFloor) {
    throw new SceneGraphIdAllocationError(
      'E_GRAPH_ID_FLOOR_INVALID',
      `Expected SceneGraph next ID floor ${derived.nextIdFloor}, received ${state.nextIdFloor}`
    )
  }
}

export class SceneGraphIdAllocator {
  private readonly reserved: Set<string>
  private nextIdFloor: number

  constructor(ids: Iterable<string> = [], state?: SceneGraphIdAllocatorStateV1) {
    this.reserved = new Set(ids)
    this.nextIdFloor = state?.nextIdFloor ?? 1
  }

  get state(): SceneGraphIdAllocatorStateV1 {
    return { version: 'open-pencil-id-allocation:1', nextIdFloor: this.nextIdFloor }
  }

  allocate(): string {
    while (this.nextIdFloor <= MAX_ID_FLOOR) {
      const id = `0:${this.nextIdFloor++}`
      if (!this.reserved.has(id)) {
        this.reserved.add(id)
        return id
      }
    }
    throw new SceneGraphIdAllocationError(
      'E_GRAPH_ID_SPACE_EXHAUSTED',
      'SceneGraph local ID space is exhausted'
    )
  }

  candidateGenerator(): () => string {
    const emitted = new Set<string>()
    let candidate = this.nextIdFloor
    return () => {
      while (candidate <= MAX_ID_FLOOR) {
        const id = `0:${candidate++}`
        if (!this.reserved.has(id) && !emitted.has(id)) {
          emitted.add(id)
          return id
        }
      }
      throw new SceneGraphIdAllocationError(
        'E_GRAPH_ID_SPACE_EXHAUSTED',
        'SceneGraph local ID space is exhausted'
      )
    }
  }

  reserve(ids: readonly string[]): void {
    const proposed = new Set<string>()
    let nextFloor = this.nextIdFloor
    for (const id of ids) {
      if (proposed.has(id) || this.reserved.has(id)) {
        throw new SceneGraphIdAllocationError(
          'E_GRAPH_ID_COLLISION',
          `SceneGraph entity ID "${id}" is already reserved`
        )
      }
      proposed.add(id)
      const value = localIdNumber(id)
      if (value !== null) {
        if (value >= MAX_ID_FLOOR) {
          throw new SceneGraphIdAllocationError(
            'E_GRAPH_ID_SPACE_EXHAUSTED',
            'SceneGraph local ID space is exhausted'
          )
        }
        nextFloor = Math.max(nextFloor, value + 1)
      }
    }
    for (const id of proposed) this.reserved.add(id)
    this.nextIdFloor = nextFloor
  }
}
