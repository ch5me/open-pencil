import { createRequire } from 'node:module'

import raw from 'unplugin-raw/rolldown'
import vue from 'unplugin-vue/rolldown'
import { defineConfig } from 'tsdown'

const require = createRequire(import.meta.url)

function atlaskitSubpathResolver() {
  const aliases = new Map([
    [
      '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item',
      '@atlaskit/pragmatic-drag-and-drop-hitbox/dist/esm/tree-item.js'
    ],
    [
      '@atlaskit/pragmatic-drag-and-drop/combine',
      '@atlaskit/pragmatic-drag-and-drop/dist/esm/entry-point/combine.js'
    ],
    [
      '@atlaskit/pragmatic-drag-and-drop/element/adapter',
      '@atlaskit/pragmatic-drag-and-drop/dist/esm/adapter/element-adapter.js'
    ]
  ])

  return {
    name: 'atlaskit-subpath-resolver',
    resolveId(id) {
      const target = aliases.get(id)
      return target ? require.resolve(target) : null
    }
  }
}

// A chunk name becomes a path under `dist`, so it may only ever describe this
// repo. Workspace modules keep their `src`-relative path; a bundled dependency
// is named after its file alone, because the rest of its path belongs to the
// build machine — `/Users/<someone>/src/...` on a canonical checkout, and an
// absolute path into the shared Grove dependency store from a worktree. Naming
// one after the last `src` segment of its absolute path wrote that layout into
// `dist`, and npm pack drops every `node_modules/` and `.git/` directory, so the
// entry chunk shipped importing files the tarball did not contain.
function chunkName(id: string) {
  const parts = id.split('?')[0].split(/[\\/]/g)
  const basename = parts.at(-1) ?? 'index'
  const srcIndex = parts.includes('node_modules') ? -1 : parts.lastIndexOf('src')
  const file = srcIndex >= 0 ? parts.slice(srcIndex + 1).join('/') : basename
  return file.replace(/\.(vue|ts)$/, '')
}

// A sourcemap `sources` entry ships too, and rolldown writes it as the path from
// the map to the module on disk — which for a bundled dependency walks out of
// the package and across the build machine. Name it from its own
// `node_modules/` down instead: same file, no machine in front of it.
function sourcemapSource(relativeSourcePath: string) {
  const parts = relativeSourcePath.split(/[\\/]/g)
  const dependencyIndex = parts.lastIndexOf('node_modules')
  return dependencyIndex >= 0 ? parts.slice(dependencyIndex).join('/') : relativeSourcePath
}

export default defineConfig({
  entry: {
    index: './src/index.ts'
  },
  platform: 'browser',
  format: ['esm'],
  dts: {
    vue: true,
    sourcemap: true,
    resolver: 'tsc'
  },
  sourcemap: true,
  hash: false,
  clean: true,
  outDir: './dist',
  treeshake: {
    moduleSideEffects: false
  },
  deps: {
    alwaysBundle: [
      '@atlaskit/pragmatic-drag-and-drop',
      /^@atlaskit\/pragmatic-drag-and-drop\//,
      '@atlaskit/pragmatic-drag-and-drop-hitbox',
      /^@atlaskit\/pragmatic-drag-and-drop-hitbox\//
    ],
    neverBundle: [
      'vue',
      /^vue\//,
      '@open-pencil/core',
      /^@open-pencil\/core\//,
      '@open-pencil/scene-graph',
      /^@open-pencil\/scene-graph\//,
      'canvaskit-wasm',
      'opentype.js',
      '@vueuse/core',
      '@nanostores/vue',
      '@nanostores/i18n',
      'nanostores',
      '@tanstack/vue-table',
      'reka-ui'
    ],
    onlyBundle: false
  },
  // `isProduction` drops the `__file` annotation unplugin-vue attaches to every
  // SFC, which is the compiling machine's absolute path to the `.vue` source —
  // `@open-pencil/vue@0.14.1` shipped three chunks carrying the worktree it was
  // built in. This is a published library build; the annotation only ever names
  // a directory the consumer does not have.
  plugins: [atlaskitSubpathResolver(), raw(), vue({ isProduction: true })],
  inputOptions: {
    preserveEntrySignatures: 'allow-extension',
    checks: {
      pluginTimings: false
    }
  },
  outputOptions: {
    minifyInternalExports: false,
    sourcemapPathTransform: sourcemapSource,
    codeSplitting: {
      groups: [
        {
          test: /(?<!\.d\.c?ts)$/,
          name: chunkName
        }
      ]
    }
  }
})
