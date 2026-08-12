import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/app/document/io/source.ts', 'utf8')

test('production save and autosave omit the main-thread renderer when worker is available', () => {
  expect(source).toContain('canUseRasterExportWorker() ? undefined')
  expect(source).toContain('const data = await exportFigFile(')
  expect(source).toContain('signal?.throwIfAborted()')
  expect(source).toContain('buildFigFile,')
  expect(source).toContain('saveOperation.run')
  expect(source).toContain('await writeFile(await buildFigFile())')
})
