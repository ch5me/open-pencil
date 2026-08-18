import { describe, expect, test } from 'bun:test'

import {
  createHistoryState,
  planHistoryClear,
  planHistoryRecord,
  planHistoryRedo,
  planHistoryUndo,
  validateHistoryState,
  type HistoryEntryId
} from '@open-pencil/scene-graph/history'

const id = (value: string): HistoryEntryId => `history:${value}`

describe('immutable SceneGraph history', () => {
  test('records, undoes, and redoes without mutating prior states', () => {
    const empty = createHistoryState<string>()
    const recorded = planHistoryRecord(empty, {
      id: id('one'),
      label: 'one',
      before: 'before',
      after: 'after'
    })

    expect(empty.undoEntryIds).toEqual([])
    expect(recorded.next.undoEntryIds).toEqual([id('one')])
    expect(recorded.selectedSnapshot).toBe('after')

    const undone = planHistoryUndo(recorded.next)
    expect(undone?.selectedSnapshot).toBe('before')
    expect(undone?.next.undoEntryIds).toEqual([])
    expect(undone?.next.redoEntryIds).toEqual([id('one')])

    const redone = planHistoryRedo(undone!.next)
    expect(redone?.selectedSnapshot).toBe('after')
    expect(redone?.next.undoEntryIds).toEqual([id('one')])
    expect(redone?.disposition.disposed).toEqual([])
  })

  test('invalidates redo, coalesces, then trims with explicit disposition', () => {
    let state = createHistoryState<number>(2)
    state = planHistoryRecord(state, {
      id: id('one'),
      label: 'one',
      before: 0,
      after: 1,
      coalesceKey: 'drag'
    }).next
    const coalesced = planHistoryRecord(state, {
      id: id('two'),
      label: 'two',
      before: 1,
      after: 2,
      coalesceKey: 'drag'
    })
    expect(coalesced.next.entries.get(id('two'))?.before).toBe(0)
    expect(coalesced.disposition.disposed).toEqual([
      { entryId: id('one'), reason: 'coalesced' }
    ])

    state = planHistoryRecord(coalesced.next, {
      id: id('three'),
      label: 'three',
      before: 2,
      after: 3
    }).next
    state = planHistoryUndo(state)!.next
    const branched = planHistoryRecord(state, {
      id: id('four'),
      label: 'four',
      before: 2,
      after: 4
    })
    expect(branched.disposition.disposed).toEqual([
      { entryId: id('three'), reason: 'redo-invalidated' }
    ])

    const trimmed = planHistoryRecord(branched.next, {
      id: id('five'),
      label: 'five',
      before: 4,
      after: 5
    })
    expect(trimmed.disposition.disposed).toEqual([
      { entryId: id('two'), reason: 'trimmed' }
    ])
    validateHistoryState(trimmed.next)
  })

  test('clear disposes every authoritative entry', () => {
    let state = createHistoryState<number>()
    state = planHistoryRecord(state, {
      id: id('one'),
      label: 'one',
      before: 0,
      after: 1
    }).next
    state = planHistoryRecord(state, {
      id: id('two'),
      label: 'two',
      before: 1,
      after: 2
    }).next
    state = planHistoryUndo(state)!.next

    const cleared = planHistoryClear(state)
    expect(cleared.selectedSnapshot).toBe(1)
    expect(cleared.next.entries.size).toBe(0)
    expect(cleared.disposition.disposed).toEqual([
      { entryId: id('one'), reason: 'cleared' },
      { entryId: id('two'), reason: 'cleared' }
    ])
  })

  test('owns immutable snapshots and exposes no mutable Map API', () => {
    const before = { value: 1, nested: { value: 2 } }
    const after = { value: 3 }
    const recorded = planHistoryRecord(createHistoryState(), {
      id: id('immutable'),
      label: 'immutable',
      before,
      after
    })
    before.nested.value = 99
    after.value = 99

    const entry = recorded.next.entries.get(id('immutable'))!
    expect(entry.before).toEqual({ value: 1, nested: { value: 2 } })
    expect(entry.after).toEqual({ value: 3 })
    expect(Object.isFrozen(entry.before)).toBe(true)
    expect('set' in recorded.next.entries).toBe(false)
  })

  test('limit zero immediately disposes recorded entries', () => {
    const recorded = planHistoryRecord(createHistoryState<number>(0), {
      id: id('zero'),
      label: 'zero',
      before: 0,
      after: 1
    })
    expect(recorded.next.entries.size).toBe(0)
    expect(recorded.next.undoEntryIds).toEqual([])
    expect(recorded.disposition.disposed).toEqual([
      { entryId: id('zero'), reason: 'trimmed' }
    ])
  })
})
