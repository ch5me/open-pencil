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
    expect(coalesced.disposition.disposed).toEqual([{ entryId: id('one'), reason: 'coalesced' }])

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
    expect(trimmed.disposition.disposed).toEqual([{ entryId: id('two'), reason: 'trimmed' }])
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

  test('blocks mutation through collection, date, and byte snapshot APIs', () => {
    const recorded = planHistoryRecord(createHistoryState(), {
      id: id('runtime-immutable'),
      label: 'runtime immutable',
      before: {
        map: new Map([['key', { value: 1 }]]),
        set: new Set([{ value: 2 }]),
        date: new Date('2026-08-18T00:00:00Z'),
        bytes: new Uint8Array([1, 2, 3])
      },
      after: null
    })
    const entry = recorded.next.entries.get(id('runtime-immutable'))
    expect(entry).toBeDefined()
    if (!entry) throw new Error('Expected immutable history entry')

    expect(() => entry.before.map.set('other', { value: 3 })).toThrow(TypeError)
    expect(() => entry.before.set.add({ value: 3 })).toThrow(TypeError)
    expect(() => entry.before.date.setUTCFullYear(2030)).toThrow(TypeError)
    expect(() => {
      entry.before.bytes[0] = 9
    }).toThrow(TypeError)
    expect(() => entry.before.bytes.fill(9)).toThrow(TypeError)
    expect(entry.before.bytes[0]).toBe(1)
    expect(new Uint8Array(entry.before.bytes.buffer)[0]).toBe(1)
    expect(recorded.selectedSnapshot).toBe(entry.after)
    expect(() => {
      recorded.selectedSnapshot.value = 9
    }).toThrow(TypeError)
  })

  test('coalesces and records previously immutable complex snapshots', () => {
    const buffer = new ArrayBuffer(2)
    new Uint8Array(buffer).set([7, 8])
    const before = {
      map: new Map([['key', { value: 1 }]]),
      set: new Set([{ value: 2 }]),
      date: new Date('2026-08-18T00:00:00Z'),
      bytes: new Uint8Array([3, 4]),
      buffer,
      view: new DataView(new Uint8Array([5, 6]).buffer)
    }
    let state = planHistoryRecord(createHistoryState<typeof before>(), {
      id: id('complex-one'),
      label: 'complex one',
      coalesceKey: 'complex',
      before,
      after: before
    }).next
    state = planHistoryRecord(state, {
      id: id('complex-two'),
      label: 'complex two',
      coalesceKey: 'complex',
      before,
      after: before
    }).next

    const coalesced = state.entries.get(id('complex-two'))
    expect(coalesced).toBeDefined()
    if (!coalesced) throw new Error('Expected coalesced history entry')
    expect(coalesced.before.map.get('key')?.value).toBe(1)
    expect(coalesced.before.bytes[0]).toBe(3)
    expect(coalesced.before.view.getUint8(0)).toBe(5)

    const rerecorded = planHistoryRecord(state, {
      id: id('complex-three'),
      label: 'complex three',
      before: coalesced.before,
      after: coalesced.after
    })
    expect(rerecorded.next.entries.get(id('complex-three'))?.before).toBe(coalesced.before)
  })

  test('limit zero immediately disposes recorded entries', () => {
    const after = { value: 1 }
    const recorded = planHistoryRecord(createHistoryState<number>(0), {
      id: id('zero'),
      label: 'zero',
      before: 0,
      after: 1
    })
    expect(recorded.next.entries.size).toBe(0)
    expect(recorded.next.undoEntryIds).toEqual([])
    expect(recorded.disposition.disposed).toEqual([{ entryId: id('zero'), reason: 'trimmed' }])

    const objectRecord = planHistoryRecord(createHistoryState<typeof after>(0), {
      id: id('zero-object'),
      label: 'zero object',
      before: { value: 0 },
      after
    })
    expect(objectRecord.selectedSnapshot).not.toBe(after)
    expect(() => {
      objectRecord.selectedSnapshot.value = 2
    }).toThrow(TypeError)
  })
})
