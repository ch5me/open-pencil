import { readFileSync } from 'node:fs'

import type { Plugin } from 'rolldown'
import { defineConfig } from 'tsdown'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function rawText(): Plugin {
  return {
    name: 'raw-text',
    load(id) {
      if (id.endsWith('?raw')) {
        const path = id.slice(0, -'?raw'.length)
        return `export default ${JSON.stringify(readFileSync(path, 'utf8'))}`
      }
    },
    transform(code, id) {
      if (id.endsWith('.md')) {
        return { code: `export default ${JSON.stringify(code)}`, map: null }
      }
    }
  }
}

function emittedWorkerUrls(): Plugin {
  const workerHosts = [
    '/io/formats/fig/read.ts',
    '/io/formats/fig/export.ts',
    '/io/formats/raster/worker-host.ts'
  ]
  return {
    name: 'emitted-worker-urls',
    transform(code, id) {
      if (!workerHosts.some((suffix) => id.endsWith(suffix))) return
      const transformed = code.replace(
        /new URL\((['"])([^'"]*\/)?([^/'"]*worker)\.ts\1, import\.meta\.url\)/g,
        'new URL($1$2$3.js$1, import.meta.url)'
      )
      return transformed === code ? undefined : { code: transformed, map: null }
    }
  }
}

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.d.ts'],
  plugins: [rawText(), emittedWorkerUrls()],
  unbundle: true,
  platform: 'neutral',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: './dist',
  deps: {
    neverBundle: [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
      /^node:/
    ],
    // Empty whitelist: nothing from node_modules may be bundled, and tsdown
    // fails the build naming anything that is. An undeclared dependency used to
    // be inlined silently, and `unbundle` then wrote each inlined module to its
    // own file named after the module's REAL path relative to the common root of
    // the build -- so a package this one forgot to declare put a slice of the
    // build machine's filesystem into `dist`, and into the import specifiers of
    // the `.d.ts` beside it. Declare the dependency instead; do not widen this.
    onlyBundle: []
  }
})
