import { describe, expect, test } from 'bun:test'

import { useEngineTransport } from '@/app/ai/acp/feature'

describe('OpenPencil engine transport flag', () => {
  test('keeps direct ACP as the default until Gate 1', () => {
    expect(useEngineTransport(undefined)).toBe(false)
    expect(useEngineTransport('false')).toBe(false)
    expect(useEngineTransport('0')).toBe(false)
  })

  test('recognizes the one bounded engine cutover flag', () => {
    expect(useEngineTransport('true')).toBe(true)
    expect(useEngineTransport('1')).toBe(true)
  })
})
