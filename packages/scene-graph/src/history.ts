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

function freezeState<TSnapshot>(
  limit: number,
  entries: ReadonlyMap<HistoryEntryId, ImmutableHistoryEntry<TSnapshot>>,
  undoEntryIds: readonly HistoryEntryId[],
  redoEntryIds: readonly HistoryEntryId[]
): ImmutableHistoryState<TSnapshot> {
  return Object.freeze({
    version: 'open-pencil-history:1' as const,
    limit,
    entries: new Map(entries),
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
    entries.set(entry.id, Object.freeze({ ...entry, before: previous.before }))
  } else {
    entries.set(entry.id, Object.freeze({ ...entry }))
  }
  undo.push(entry.id)

  if (Number.isFinite(state.limit) && state.limit > 0) {
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
