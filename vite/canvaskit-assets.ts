import { spawnSync } from 'node:child_process'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { Connect, Plugin, ResolvedConfig } from 'vite'

// Clear a macOS immutable flag from a file we are about to overwrite. Only ever
// the destination: the source may be an immutable dependency store, and that is
// deliberate. Failure stays silent here because the write immediately after it
// reports the same EPERM with the path that matters.
function clearImmutableFlag(path: string) {
  if (process.platform !== 'darwin' || !existsSync(path)) return
  spawnSync('chflags', ['nouchg', path])
}

function syncWasmFromNodeModules(root: string, source: string, destination: string) {
  const sourcePath = resolve(root, source)
  const destinationPath = resolve(root, destination)
  if (!existsSync(sourcePath)) {
    console.warn(`[copy-canvaskit-wasm] Missing source (run \`bun install\`): ${sourcePath}`)
    return
  }
  mkdirSync(dirname(destinationPath), { recursive: true })
  // Replace the destination rather than `copyFileSync`: on macOS that clones the
  // file (`fclonefileat`), and a clone carries the SOURCE's mode and BSD flags to
  // the destination. Under Grove these sources live in a shared dependency store
  // marked `uchg` and `a-w`, so a cloned `public/canvaskit.wasm` came out
  // immutable and read-only too -- then Vite's own `publicDir` copy cloned that
  // one hop further into the build's `outDir`, where even `rm -rf` fails with
  // EPERM. Unlinking first also clears whatever an earlier build left behind.
  // Build output belongs to this repo; it should carry nothing the store put on
  // its payload to protect it.
  clearImmutableFlag(destinationPath)
  rmSync(destinationPath, { force: true })
  writeFileSync(destinationPath, readFileSync(sourcePath))
}

function serveCanvasKitWasm(root: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const pathname = req.url?.split('?')[0] ?? ''
    if (pathname !== '/canvaskit.wasm' && pathname !== '/canvaskit-webgpu/canvaskit.wasm') {
      next()
      return
    }

    const publicPath = resolve(root, pathname.slice(1))
    const fallbackPath =
      pathname === '/canvaskit.wasm'
        ? resolve(root, 'node_modules/canvaskit-wasm/bin/canvaskit.wasm')
        : resolve(root, 'packages/core/vendor/canvaskit-webgpu/canvaskit.wasm')

    const file = existsSync(publicPath) ? publicPath : fallbackPath
    if (!existsSync(file)) {
      next()
      return
    }

    res.setHeader('Content-Type', 'application/wasm')
    res.setHeader('Cache-Control', 'no-cache')
    createReadStream(file).on('error', next).pipe(res)
  }
}

export function copyCanvasKitAssetsPlugin(): Plugin {
  let root = process.cwd()

  return {
    name: 'copy-canvaskit-wasm',
    enforce: 'pre',
    configResolved(config: ResolvedConfig) {
      root = config.root
    },
    buildStart() {
      syncWasmFromNodeModules(
        root,
        'node_modules/canvaskit-wasm/bin/canvaskit.wasm',
        'public/canvaskit.wasm'
      )
      syncWasmFromNodeModules(
        root,
        'packages/core/vendor/canvaskit-webgpu/canvaskit.wasm',
        'public/canvaskit-webgpu/canvaskit.wasm'
      )
      syncWasmFromNodeModules(
        root,
        'packages/core/vendor/canvaskit-webgpu/canvaskit.js',
        'public/canvaskit-webgpu/canvaskit.js'
      )
    },
    configureServer(server) {
      server.middlewares.use(serveCanvasKitWasm(server.config.root))
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveCanvasKitWasm(server.config.root))
    }
  }
}
