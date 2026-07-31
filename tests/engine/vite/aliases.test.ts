import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

describe('Vite aliases', () => {
  test('targets the shipped opentype ESM bundle', async () => {
    const root = process.cwd()
    const bundle = path.join(root, 'node_modules/opentype.js/dist/opentype.module.js')
    const { createOpenPencilAliases } = await import(
      pathToFileURL(path.join(root, 'vite/aliases.ts')).href
    )
    const alias = createOpenPencilAliases(root).find(
      (entry: { find: string | RegExp }) => entry.find === 'opentype.js'
    )

    expect(alias?.replacement).toBe(bundle)
    expect(existsSync(bundle)).toBe(true)
  })
})
