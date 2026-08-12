import { mockIPC } from '@tauri-apps/api/mocks'

type FixtureMode = 'ordinary' | 'pre-abort' | 'active-boundary'

const mode = (process.argv[2] ?? 'ordinary') as FixtureMode
const windowLike = globalThis as typeof globalThis & {
  __TAURI_INTERNALS__?: unknown
  __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown
}
Object.assign(globalThis, { window: windowLike })

let invokeCount = 0
mockIPC((cmd, args) => {
  invokeCount++
  if (cmd !== 'build_fig_file') throw new Error(`Unexpected command: ${cmd}`)
  const payload = args as {
    schemaDeflated: number[]
    kiwiData: number[]
    thumbnailPng: number[]
    metaJson: string
    images: Array<{ name: string; data: number[] }>
  }
  if (payload.schemaDeflated.length === 0) throw new Error('schemaDeflated is empty')
  if (payload.kiwiData.length === 0) throw new Error('kiwiData is empty')
  if (payload.thumbnailPng.length === 0) throw new Error('thumbnailPng is empty')
  if (payload.images.length !== 0) throw new Error('images should be empty')
  JSON.parse(payload.metaJson)
  return [7, 8, 9]
})

const [{ exportFigFile }, { SceneGraph }] = await Promise.all([
  import('@open-pencil/core/io/formats/fig/export'),
  import('@open-pencil/scene-graph')
])

if (mode === 'ordinary') {
  const bytes = await exportFigFile(new SceneGraph())
  if (bytes.length !== 3 || bytes[0] !== 7 || bytes[1] !== 8 || bytes[2] !== 9) {
    throw new Error(`Unexpected export bytes: ${Array.from(bytes).join(',')}`)
  }
} else {
  const controller = new AbortController()
  if (mode === 'pre-abort') controller.abort()
  try {
    await exportFigFile(new SceneGraph(), undefined, undefined, undefined, false, controller.signal)
    throw new Error('Expected cancellable Tauri export to fail')
  } catch (error) {
    const cause = error as Error & { code?: string }
    const expected =
      mode === 'pre-abort'
        ? { name: 'IOCancelledError', code: 'io-import-cancelled' }
        : {
            name: 'FigCompressionCancellationUnsupportedError',
            code: 'fig-compression-cancellation-unsupported'
          }
    if (cause.name !== expected.name || cause.code !== expected.code) throw error
  }
}

await Bun.sleep(10)
if (invokeCount !== (mode === 'ordinary' ? 1 : 0)) {
  throw new Error(`Unexpected invoke count: ${invokeCount}`)
}
