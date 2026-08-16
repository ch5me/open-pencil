import { describe, expect, test } from 'bun:test'

import { resolveAllowedOrigin } from './cors'

describe('resolveAllowedOrigin', () => {
  test('accepts deployed and fixed-port development origins', () => {
    expect(resolveAllowedOrigin('https://design.elf.dance', 'api.openpencil.dev')).toBe(
      'https://design.elf.dance'
    )
    expect(resolveAllowedOrigin('http://127.0.0.1:1420', '127.0.0.1:8787')).toBe(
      'http://127.0.0.1:1420'
    )
  })

  test('accepts same-tree OpenPencil app origins served through the CH5 development proxy', () => {
    expect(
      resolveAllowedOrigin(
        'http://app.open-pencil.localhost:7300',
        'api.open-pencil.localhost:7300'
      )
    ).toBe('http://app.open-pencil.localhost:7300')
    expect(
      resolveAllowedOrigin(
        'http://app.openpencil-local-bootstrap.localhost:7300',
        'api.openpencil-local-bootstrap.localhost:7300'
      )
    ).toBe('http://app.openpencil-local-bootstrap.localhost:7300')
    expect(
      resolveAllowedOrigin(
        'http://app.open-pencil.ch5-laptop-m5.dev.ch5.me:7300',
        'api.open-pencil.ch5-laptop-m5.dev.ch5.me:7300'
      )
    ).toBe('http://app.open-pencil.ch5-laptop-m5.dev.ch5.me:7300')
  })

  test('rejects cross-tree, cross-box, deployed API, port, and suffix mismatches', () => {
    expect(
      resolveAllowedOrigin('http://app.other-tree.localhost:7300', 'api.open-pencil.localhost:7300')
    ).toBeUndefined()
    expect(
      resolveAllowedOrigin(
        'http://app.open-pencil.other-box.dev.ch5.me:7300',
        'api.open-pencil.ch5-laptop-m5.dev.ch5.me:7300'
      )
    ).toBeUndefined()
    expect(
      resolveAllowedOrigin('http://app.open-pencil.localhost:7300', 'api.openpencil.dev')
    ).toBeUndefined()
    expect(
      resolveAllowedOrigin(
        'http://app.open-pencil.localhost:7301',
        'api.open-pencil.localhost:7300'
      )
    ).toBeUndefined()
    expect(
      resolveAllowedOrigin(
        'https://app.open-pencil.localhost:7300',
        'api.open-pencil.localhost:7300'
      )
    ).toBeUndefined()
    expect(
      resolveAllowedOrigin(
        'http://app.open-pencil.localhost.evil.test:7300',
        'api.open-pencil.localhost:7300'
      )
    ).toBeUndefined()
  })
})
