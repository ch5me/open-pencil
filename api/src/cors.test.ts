import { describe, expect, test } from 'bun:test'

import { resolveAllowedOrigin } from './cors'

describe('resolveAllowedOrigin', () => {
  test('accepts deployed and fixed-port development origins', () => {
    expect(resolveAllowedOrigin('https://design.elf.dance')).toBe('https://design.elf.dance')
    expect(resolveAllowedOrigin('http://127.0.0.1:1420')).toBe('http://127.0.0.1:1420')
  })

  test('accepts OpenPencil app origins served through the CH5 development proxy', () => {
    expect(resolveAllowedOrigin('http://app.open-pencil.localhost:7300')).toBe(
      'http://app.open-pencil.localhost:7300'
    )
    expect(resolveAllowedOrigin('http://app.openpencil-local-bootstrap.localhost:7300')).toBe(
      'http://app.openpencil-local-bootstrap.localhost:7300'
    )
    expect(resolveAllowedOrigin('http://app.open-pencil.ch5-laptop-m5.dev.ch5.me:7300')).toBe(
      'http://app.open-pencil.ch5-laptop-m5.dev.ch5.me:7300'
    )
  })

  test('rejects unrelated local hosts, ports, and suffixes', () => {
    expect(resolveAllowedOrigin('http://api.open-pencil.localhost:7300')).toBeUndefined()
    expect(resolveAllowedOrigin('http://app.open-pencil.localhost:7301')).toBeUndefined()
    expect(resolveAllowedOrigin('https://app.open-pencil.localhost:7300')).toBeUndefined()
    expect(resolveAllowedOrigin('http://app.open-pencil.localhost.evil.test:7300')).toBeUndefined()
  })
})
