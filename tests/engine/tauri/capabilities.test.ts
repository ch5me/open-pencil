import { describe, expect, test } from 'bun:test'

const capability = await Bun.file('desktop/capabilities/default.json').json()

describe('Tauri capability contract', () => {
  test('scopes file renames to the app-local cache', () => {
    const rename = capability.permissions.find(
      (permission) => typeof permission === 'object' && permission.identifier === 'fs:allow-rename'
    )

    expect(rename).toEqual({
      identifier: 'fs:allow-rename',
      allow: [{ path: '$APPLOCALDATA/cache/v1/**' }]
    })

    const glob = new Bun.Glob(rename.allow[0].path.replace('$APPLOCALDATA', 'app-local-data'))
    expect(glob.match('app-local-data/cache/v1/font-cache/v1/manifest')).toBe(true)
    expect(glob.match('app-local-data/documents/unrelated.fig')).toBe(false)
  })
})
