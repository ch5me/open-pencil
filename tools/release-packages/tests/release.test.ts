import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import { preflightAbsentVersions, PUBLISH_ORDER, tarballIntegrity } from '../src/release'

const packages = PUBLISH_ORDER.map((shortName) => ({
  dir: `packages/${shortName}`,
  name: `@open-pencil/${shortName}`,
  shortName,
  version: '0.14.1'
}))

describe('preflightAbsentVersions', () => {
  test('keeps dependency-first publish order', () => {
    expect(PUBLISH_ORDER).toEqual([
      'scene-graph',
      'kiwi',
      'pen',
      'fig',
      'core',
      'dom-css',
      'mcp',
      'vue',
      'cli'
    ])
  })

  test('accepts an entirely unpublished release set', async () => {
    await expect(preflightAbsentVersions(packages, async () => undefined)).resolves.toBeUndefined()
  })

  test('rejects any existing package version instead of skipping it', async () => {
    await expect(
      preflightAbsentVersions(packages, async (name) =>
        name === '@open-pencil/core' || name === '@open-pencil/scene-graph'
          ? 'sha512-existing'
          : undefined
      )
    ).rejects.toThrow(
      'Release versions already exist: @open-pencil/scene-graph@0.14.1, @open-pencil/core@0.14.1'
    )
  })

  test('computes npm-compatible sha512 integrity', async () => {
    const path = fileURLToPath(import.meta.url)
    const file = Bun.file(path)
    const bytes = await file.arrayBuffer()
    const expected = new Bun.CryptoHasher('sha512').update(bytes).digest('base64')
    expect(await tarballIntegrity(path)).toBe(`sha512-${expected}`)
  })
})
