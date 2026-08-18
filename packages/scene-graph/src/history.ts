export type HistoryEntryId = `history:${string}`

export type HistoryDispositionReason =
  | 'coalesced'
  | 'redo-invalidated'
  | 'trimmed'
  | 'cleared'

export interface ImmutableHistoryEntry<TSnapshot> {
  readonly id: HistoryEntryId
  readonly label: string
  readonly before: TSnapshot
  readonly after: TSnapshot
  readonly coalesceKey?: string
}

export interface ImmutableHistoryState<TSnapshot> {
  readonly version: 'open-pencil-history:1'
  readonly limit: number
  readonly entries: ReadonlyMap<HistoryEntryId, ImmutableHistoryEntry<TSnapshot>>
  readonly undoEntryIds: readonly HistoryEntryId[]
  readonly redoEntryIds: readonly HistoryEntryId[]
}

export interface HistoryDisposition {
  readonly disposed: readonly {
    readonly entryId: HistoryEntryId
    readonly reason: HistoryDispositionReason
  }[]
}

export interface HistoryPlan<TSnapshot> {
  readonly previous: ImmutableHistoryState<TSnapshot>
  readonly next: ImmutableHistoryState<TSnapshot>
  readonly selectedSnapshot: TSnapshot
  readonly disposition: HistoryDisposition
  readonly operation: 'record' | 'undo' | 'redo' | 'clear'
}

const DEFAULT_HISTORY_LIMIT = 200

class ImmutableMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #map: Map<K, V>

  constructor(entries: ReadonlyMap<K, V>) {
    this.#map = new Map(entries)
  }

  get size(): number {
    return this.#map.size
  }

  get(key: K): V | undefined {
    return this.#map.get(key)
  }

  has(key: K): boolean {
    return this.#map.has(key)
  }

  entries(): MapIterator<[K, V]> {
    return this.#map.entries()
  }

  keys(): MapIterator<K> {
    return this.#map.keys()
  }

  values(): MapIterator<V> {
    return this.#map.values()
  }

  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.#map.forEach((value, key) => callbackfn.call(thisArg, value, key, this))
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#map[Symbol.iterator]()
  }
}

const MAP_MUTATORS = new Set<PropertyKey>(['set', 'delete', 'clear'])
const SET_MUTATORS = new Set<PropertyKey>(['add', 'delete', 'clear'])
const VIEW_MUTATORS = new Set<PropertyKey>([
  'copyWithin',
  'fill',
  'reverse',
  'set',
  'sort',
  'setBigInt64',
  'setBigUint64',
  'setFloat32',
  'setFloat64',
  'setInt8',
  'setInt16',
  'setInt32',
  'setUint8',
  'setUint16',
  'setUint32'
])

function immutableMutation(): never {
  throw new TypeError('History snapshots are immutable')
}

function immutableCollection<T extends object>(target: T, mutators: ReadonlySet<PropertyKey>): T {
  return new Proxy(target, {
    get(collection, property) {
      if (mutators.has(property)) return immutableMutation
      const value = Reflect.get(collection, property, collection)
      return typeof value === 'function' ? value.bind(collection) : value
    },
    set: immutableMutation,
    defineProperty: immutableMutation,
    deleteProperty: immutableMutation,
    setPrototypeOf: immutableMutation
  })
}

function immutableView<T extends ArrayBufferView>(view: T): T {
  return new Proxy(view, {
    get(target, property) {
      if (VIEW_MUTATORS.has(property)) return immutableMutation
      if (property === 'buffer') return target.buffer.slice(0)
      if (property === 'subarray' && 'slice' in target) {
        const sliceable = target as T & { slice(start?: number, end?: number): T }
        return (start?: number, end?: number) => immutableView(sliceable.slice(start, end))
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set: immutableMutation,
    defineProperty: immutableMutation,
    deleteProperty: immutableMutation,
    setPrototypeOf: immutableMutation
  })
}

function immutableClone<T>(value: T): T {
  const seen = new WeakMap<object, object>()
  const transform = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate !== 'object') return candidate
    const existing = seen.get(candidate)
    if (existing) return existing

    if (candidate instanceof Map) {
      const target = new Map()
      const immutable = immutableCollection(target, MAP_MUTATORS)
      seen.set(candidate, immutable)
      for (const [key, mapValue] of candidate) target.set(transform(key), transform(mapValue))
      return immutable
    }
    if (candidate instanceof Set) {
      const target = new Set()
      const immutable = immutableCollection(target, SET_MUTATORS)
      seen.set(candidate, immutable)
      for (const item of candidate) target.add(transform(item))
      return immutable
    }
    if (ArrayBuffer.isView(candidate)) {
      const immutable = immutableView(candidate)
      seen.set(candidate, immutable)
      return immutable
    }
    if (candidate instanceof ArrayBuffer) {
      const immutable = immutableCollection(candidate, new Set())
      seen.set(candidate, immutable)
      return immutable
    }
    if (candidate instanceof Date) {
      const immutable = immutableCollection(
        candidate,
        new Set(
          Object.getOwnPropertyNames(Date.prototype).filter((property) => property.startsWith('set'))
        )
      )
      seen.set(candidate, immutable)
      return immutable
    }

    seen.set(candidate, candidate)
    for (const key of Reflect.ownKeys(candidate)) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
      if (descriptor && 'value' in descriptor) {
        Object.defineProperty(candidate, key, { ...descriptor, value: transform(descriptor.value) })
      }
    }
    return Object.freeze(candidate)
  }
  return transform(structuredClone(value)) as T
}

function immutableEntry<TSnapshot>(
  entry: ImmutableHistoryEntry<TSnapshot>,
  before = entry.before
): ImmutableHistoryEntry<TSnapshot> {
  return Object.freeze({
    ...entry,
    before: immutableClone(before),
    after: immutableClone(entry.after)
  })
}

function freezeState<TSnapshot>(
  limit: number,
  entries: ReadonlyMap<HistoryEntryId, ImmutableHistoryEntry<TSnapshot>>,
  undoEntryIds: readonly HistoryEntryId[],
  redoEntryIds: readonly HistoryEntryId[]
): ImmutableHistoryState<TSnapshot> {
  return Object.freeze({
    version: 'open-pencil-history:1' as const,
    limit,
    entries: new ImmutableMapView(entries),
    undoEntryIds: Object.freeze([...undoEntryIds]),
    redoEntryIds: Object.freeze([...redoEntryIds])
  })
}

export function createHistoryState<TSnapshot>(
  limit = DEFAULT_HISTORY_LIMIT
): ImmutableHistoryState<TSnapshot> {
  if (!Number.isFinite(limit)) return freezeState(limit, new Map(), [], [])
  return freezeState(Math.max(0, Math.floor(limit)), new Map(), [], [])
}

export function validateHistoryState<TSnapshot>(
  state: ImmutableHistoryState<TSnapshot>
): void {
  if (state.version !== 'open-pencil-history:1') throw new Error('Invalid history version')
  if (Number.isNaN(state.limit) || state.limit < 0) throw new Error('Invalid history limit')
  const seen = new Set<HistoryEntryId>()
  for (const id of [...state.undoEntryIds, ...state.redoEntryIds]) {
    if (seen.has(id)) throw new Error(`Duplicate history entry ID "${id}"`)
    if (!state.entries.has(id)) throw new Error(`Missing history entry "${id}"`)
    seen.add(id)
  }
  if (seen.size !== state.entries.size) throw new Error('History contains unreachable entries')
}

export function planHistoryRecord<TSnapshot>(
  state: ImmutableHistoryState<TSnapshot>,
  entry: ImmutableHistoryEntry<TSnapshot>
): HistoryPlan<TSnapshot> {
  validateHistoryState(state)
  if (state.entries.has(entry.id)) throw new Error(`History entry "${entry.id}" already exists`)

  const entries = new Map(state.entries)
  const undo = [...state.undoEntryIds]
  const disposed: HistoryDisposition['disposed'][number][] = []

  for (const id of state.redoEntryIds) {
    entries.delete(id)
    disposed.push({ entryId: id, reason: 'redo-invalidated' })
  }

  const previousId = undo.at(-1)
  const previous = previousId ? entries.get(previousId) : undefined
  if (entry.coalesceKey && previous?.coalesceKey === entry.coalesceKey && previousId) {
    undo.pop()
    entries.delete(previousId)
    disposed.push({ entryId: previousId, reason: 'coalesced' })
    entries.set(entry.id, immutableEntry(entry, previous.before))
  } else {
    entries.set(entry.id, immutableEntry(entry))
  }
  undo.push(entry.id)

  if (Number.isFinite(state.limit)) {
    while (undo.length > state.limit) {
      const id = undo.shift()
      if (!id) break
      entries.delete(id)
      disposed.push({ entryId: id, reason: 'trimmed' })
    }
  }

  const next = freezeState(state.limit, entries, undo, [])
  return Object.freeze({
    previous: state,
    next,
    selectedSnapshot: entry.after,
    disposition: Object.freeze({ disposed: Object.freeze(disposed) }),
    operation: 'record' as const
  })
}

export function planHistoryUndo<TSnapshot>(
  state: ImmutableHistoryState<TSnapshot>
): HistoryPlan<TSnapshot> | null {
  validateHistoryState(state)
  const undo = [...state.undoEntryIds]
  const id = undo.pop()
  if (!id) return null
  const entry = state.entries.get(id)
  if (!entry) throw new Error(`Missing history entry "${id}"`)
  const next = freezeState(state.limit, state.entries, undo, [...state.redoEntryIds, id])
  return Object.freeze({
    previous: state,
    next,
    selectedSnapshot: entry.before,
    disposition: Object.freeze({ disposed: Object.freeze([]) }),
    operation: 'undo' as const
  })
}

export function planHistoryRedo<TSnapshot>(
  state: ImmutableHistoryState<TSnapshot>
): HistoryPlan<TSnapshot> | null {
  validateHistoryState(state)
  const redo = [...state.redoEntryIds]
  const id = redo.pop()
  if (!id) return null
  const entry = state.entries.get(id)
  if (!entry) throw new Error(`Missing history entry "${id}"`)
  const next = freezeState(state.limit, state.entries, [...state.undoEntryIds, id], redo)
  return Object.freeze({
    previous: state,
    next,
    selectedSnapshot: entry.after,
    disposition: Object.freeze({ disposed: Object.freeze([]) }),
    operation: 'redo' as const
  })
}

export function planHistoryClear<TSnapshot>(
  state: ImmutableHistoryState<TSnapshot>
): HistoryPlan<TSnapshot> {
  validateHistoryState(state)
  const ids = [...state.undoEntryIds, ...state.redoEntryIds]
  const current = state.undoEntryIds.at(-1)
    ? state.entries.get(state.undoEntryIds.at(-1)!)?.after
    : state.redoEntryIds.at(-1)
      ? state.entries.get(state.redoEntryIds.at(-1)!)?.before
      : undefined
  const next = freezeState<TSnapshot>(state.limit, new Map(), [], [])
  return Object.freeze({
    previous: state,
    next,
    selectedSnapshot: current as TSnapshot,
    disposition: Object.freeze({
      disposed: Object.freeze(ids.map((entryId) => ({ entryId, reason: 'cleared' as const })))
    }),
    operation: 'clear' as const
  })
}
