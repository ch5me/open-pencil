import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/index.ts'
  },
  platform: 'node',
  format: ['esm'],
  sourcemap: true,
  clean: true,
  outDir: process.env.OPENPENCIL_CLI_OUT_DIR ?? './dist',
  treeshake: false,
  deps: {
    neverBundle: ['@open-pencil/core', /^@open-pencil\/core\//, 'canvaskit-wasm', /^node:/],
    onlyBundle: false
  }
})
