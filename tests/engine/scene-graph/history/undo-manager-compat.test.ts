import { describe, expect, test } from 'bun:test'

import {
  createHistoryState,
  planHistoryClear,
  planHistoryRecord,
  planHistoryRedo,
  planHistoryUndo,
  type HistoryEntryId
} from '@open-pencil/scene-graph/history'
import { UndoManager } from '@open-pencil/scene-graph/undo'

const id = (value: string): HistoryEntryId => `history:${value}`

describe('immutable history compatibility with UndoManager', () => {
  test('matches labels, branching, coalescing, trim, and clear traces', () => {
    const legacy = new UndoManager({ limit: 2 })
    let legacyValue = 0
    let state = createHistoryState<number>(2)

    const record = (entryId: string, after: number, coalesceKey?: string) => {
      const before = legacyValue
      legacy.execute({
        label: entryId,
        coalesceKey,
        forward: () => {
          legacyValue = after
        },
        inverse: () => {
          legacyValue = before
        }
      })
      state = planHistoryRecord(state, {
        id: id(entryId),
        label: entryId,
        before,
        after,
        coalesceKey
      }).next
      expect(
        state.undoEntryIds.at(-1) && state.entries.get(state.undoEntryIds.at(-1)!)?.label
      ).toBe(legacy.undoLabel)
    }

    record('one', 1, 'drag')
    record('two', 2, 'drag')
    record('three', 3)

    expect(legacy.undo()).toBe('three')
    const undo = planHistoryUndo(state)!
    state = undo.next
    expect(undo.selectedSnapshot).toBe(legacyValue)
    expect(state.redoEntryIds.at(-1) && state.entries.get(state.redoEntryIds.at(-1)!)?.label).toBe(
      legacy.redoLabel
    )

    expect(legacy.redo()).toBe('three')
    const redo = planHistoryRedo(state)!
    state = redo.next
    expect(redo.selectedSnapshot).toBe(legacyValue)

    legacy.clear()
    state = planHistoryClear(state).next
    expect(state.undoEntryIds).toEqual([])
    expect(legacy.canUndo).toBe(false)
  })
})
