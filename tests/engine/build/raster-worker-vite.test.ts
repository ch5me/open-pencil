import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { build } from 'vite'

test('production browser build bundles the raster worker', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'open-pencil-vite-'))
  try {
    await build({
      build: { emptyOutDir: true, outDir },
      logLevel: 'silent'
    })
    const outputs = new Bun.Glob('assets/worker-*.js').scan({ cwd: outDir })
    expect(await Array.fromAsync(outputs)).not.toHaveLength(0)
  } finally {
    await rm(outDir, { force: true, recursive: true })
  }
}, 60_000)
