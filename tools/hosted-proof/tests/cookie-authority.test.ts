import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const sources = ['hosted.ts', 'preview.ts']

describe('hosted proof cookie authority', () => {
  for (const source of sources) {
    test(`${source} uses the API cookie constant`, async () => {
      const contents = await readFile(new URL(`../src/${source}`, import.meta.url), 'utf8')

      expect(contents).toContain('ELF_JWT_COOKIE')
      expect(contents).not.toContain("'ELF_JWT'")
    })
  }
})
