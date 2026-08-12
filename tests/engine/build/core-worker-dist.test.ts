import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const workers = [
  ['io/formats/fig/read.js', '../../../kiwi/fig/parse/worker.js'],
  ['io/formats/fig/export.js', './export-worker.js'],
  ['io/formats/psd/raster.js', './raster-worker.js'],
  ['io/formats/raster/worker-host.js', './worker.js']
] as const

test('core dist emits runnable worker URLs and files', async () => {
  const dist = new URL('../../../packages/core/dist/', import.meta.url)

  for (const [modulePath, workerPath] of workers) {
    const moduleURL = new URL(modulePath, dist)
    expect(await readFile(moduleURL, 'utf8')).toContain(`new URL("${workerPath}", import.meta.url)`)
    expect(Bun.file(new URL(workerPath, moduleURL)).size).toBeGreaterThan(0)
  }
})
