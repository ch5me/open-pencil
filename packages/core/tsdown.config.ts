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
  return {
    name: 'emitted-worker-urls',
    transform(code) {
      return code.replace(
        /new URL\((['"])([^'"]*\/)?([^/'"]*worker)\.ts\1, import\.meta\.url\)/g,
        'new URL($1$2$3.js$1, import.meta.url)'
      )
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
    onlyBundle: false
  }
})
