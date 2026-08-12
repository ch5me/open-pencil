import { afterEach, describe, expect, test } from 'bun:test'

import {
  clearDownloadedFontCache,
  createTauriDownloadedFontCache,
  downloadedFontCacheSummary
} from '@/app/editor/fonts/cache'

import { clearTauriMocks, mockTauriIPC } from '#tests/helpers/tauri/mocks'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const MANIFEST_PATH = 'cache/v1/font-cache/v1/manifest'

type CacheFileMock = {
  files: Map<string, Uint8Array>
  onWrite?: (path: string) => Promise<void> | void
  onRename?: (from: string, to: string) => Promise<void> | void
}

async function mockCacheFiles(mock: CacheFileMock) {
  await mockTauriIPC(async (cmd, args, options) => {
    if (cmd === 'plugin:fs|read_file') {
      const path = (args as { path: string }).path
      const value = mock.files.get(path)
      if (!value) throw new Error('missing')
      return [...value]
    }
    if (cmd === 'plugin:fs|write_file') {
      const path = decodeURIComponent((options as { headers: { path: string } }).headers.path)
      await mock.onWrite?.(path)
      mock.files.set(path, new Uint8Array(args as ArrayBufferLike))
      return null
    }
    if (cmd === 'plugin:fs|rename') {
      const { oldPath, newPath } = args as { oldPath: string; newPath: string }
      await mock.onRename?.(oldPath, newPath)
      const value = mock.files.get(oldPath)
      if (!value) throw new Error('missing')
      mock.files.set(newPath, value)
      mock.files.delete(oldPath)
      return null
    }
    if (cmd === 'plugin:fs|remove') {
      mock.files.delete((args as { path: string }).path)
      return null
    }
    return null
  })
}

function manifest(mock: CacheFileMock) {
  const raw = mock.files.get(MANIFEST_PATH)
  if (!raw) return null
  return (
    JSON.parse(decoder.decode(raw)) as {
      value: { entries: Record<string, { file: string; family: string }> }
    }
  ).value
}

function deferred() {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve: () => resolve?.() }
}

afterEach(async () => {
  await clearTauriMocks()
})

describe('Tauri downloaded font cache helpers', () => {
  test('summarizes manifest entries through mocked plugin-fs IPC', async () => {
    await mockTauriIPC((cmd, args) => {
      expect(cmd).toBe('plugin:fs|read_file')
      expect(args).toMatchObject({ path: 'cache/v1/font-cache/v1/manifest' })
      return [
        ...encoder.encode(
          JSON.stringify({
            updatedAt: 300,
            value: {
              version: 1,
              entries: {
                one: {
                  family: 'Noto Sans SC',
                  style: 'Regular',
                  file: 'one.ttf',
                  byteLength: 10,
                  sha256: 'a',
                  updatedAt: 100
                },
                two: {
                  family: 'Noto Naskh Arabic',
                  style: 'Regular',
                  file: 'two.ttf',
                  byteLength: 25,
                  sha256: 'b',
                  updatedAt: 250
                }
              }
            }
          })
        )
      ]
    })

    await expect(downloadedFontCacheSummary()).resolves.toEqual({
      count: 2,
      byteLength: 35,
      updatedAt: 250
    })
  })

  test('returns an empty summary when manifest is missing', async () => {
    await mockTauriIPC((cmd) => {
      expect(cmd).toBe('plugin:fs|read_file')
      throw new Error('missing')
    })

    await expect(downloadedFontCacheSummary()).resolves.toEqual({
      count: 0,
      byteLength: 0,
      updatedAt: null
    })
  })

  test('clears the cache directory through mocked plugin-fs IPC', async () => {
    const calls: Array<{ cmd: string; args: unknown }> = []
    await mockTauriIPC((cmd, args) => {
      calls.push({ cmd, args })
      return null
    })

    await clearDownloadedFontCache()

    const { BaseDirectory } = await import('@tauri-apps/plugin-fs')
    expect(calls).toEqual([
      {
        cmd: 'plugin:fs|remove',
        args: {
          path: 'cache/v1/font-cache/v1',
          options: { baseDir: BaseDirectory.AppLocalData, recursive: true }
        }
      }
    ])
  })

  test('removes staged bytes and skips manifest publication after mid-write abort', async () => {
    const calls: Array<{ cmd: string; path?: string }> = []
    let releaseByteWrite: (() => void) | undefined
    let byteWriteStarted: (() => void) | undefined
    const byteWrite = new Promise<void>((resolve) => {
      byteWriteStarted = resolve
    })
    const byteWriteRelease = new Promise<void>((resolve) => {
      releaseByteWrite = resolve
    })
    let writes = 0
    await mockTauriIPC(async (cmd, args, options) => {
      const path =
        (args as { path?: string }).path ??
        (options as { headers?: { path?: string } } | undefined)?.headers?.path
      calls.push({ cmd, path })
      if (cmd === 'plugin:fs|read_file') throw new Error('missing')
      if (cmd === 'plugin:fs|write_file' && writes++ === 0) {
        byteWriteStarted?.()
        await byteWriteRelease
      }
      return null
    })

    const controller = new AbortController()
    const writing = createTauriDownloadedFontCache().write(
      'Abort Cache',
      'Regular',
      new Uint8Array([1, 2, 3, 4]).buffer,
      controller.signal
    )
    await byteWrite
    controller.abort()
    releaseByteWrite?.()

    await expect(writing).rejects.toBeInstanceOf(DOMException)
    expect(
      calls.some(({ cmd, path }) => cmd === 'plugin:fs|remove' && path?.includes('/files/'))
    ).toBe(true)
    expect(
      calls.some(({ cmd, path }) => cmd === 'plugin:fs|write_file' && path?.endsWith('/manifest'))
    ).toBe(false)
  })

  test.each(['abort', 'timeout'])(
    'blocked manifest write preserves old state on %s',
    async (kind) => {
      const mock: CacheFileMock = { files: new Map() }
      await mockCacheFiles(mock)
      const cache = createTauriDownloadedFontCache()
      const oldData = new Uint8Array([1, 2, 3]).buffer
      await cache.write('Blocked Cache', 'Regular', oldData)
      const oldManifest = mock.files.get(MANIFEST_PATH)?.slice()
      const oldFile = Object.values(manifest(mock)?.entries ?? {})[0]?.file
      const blocked = deferred()
      const started = deferred()
      mock.onWrite = async (path) => {
        if (!path.includes('/manifest-')) return
        started.resolve()
        await blocked.promise
      }

      const controller = new AbortController()
      const writing = cache.write(
        'Blocked Cache',
        'Regular',
        new Uint8Array([4, 5, 6]).buffer,
        kind === 'timeout' ? AbortSignal.timeout(25) : controller.signal
      )
      await started.promise
      if (kind === 'abort') controller.abort()

      await expect(writing).rejects.toBeInstanceOf(DOMException)
      expect(mock.files.get(MANIFEST_PATH)).toEqual(oldManifest)
      expect(oldFile && mock.files.has(`cache/v1/font-cache/v1/files/${oldFile}`)).toBe(true)
      blocked.resolve()
    }
  )

  test('serializes concurrent same-content and different-content writers', async () => {
    const mock: CacheFileMock = { files: new Map() }
    await mockCacheFiles(mock)
    const cache = createTauriDownloadedFontCache()
    const same = new Uint8Array([1, 2, 3]).buffer

    await Promise.all([
      cache.write('One', 'Regular', same),
      cache.write('One', 'Regular', same),
      cache.write('Two', 'Regular', new Uint8Array([4, 5, 6]).buffer)
    ])

    const entries = Object.values(manifest(mock)?.entries ?? {})
    expect(entries.map(({ family }) => family).sort()).toEqual(['One', 'Two'])
    expect(await cache.read('One', 'Regular')).toEqual(same)
    expect(await cache.read('Two', 'Regular')).toEqual(new Uint8Array([4, 5, 6]).buffer)
    expect([...mock.files.keys()].filter((path) => path.includes('/files/')).length).toBe(2)
  })

  test('reads wait for commit and observe the committed write', async () => {
    const mock: CacheFileMock = { files: new Map() }
    const blocked = deferred()
    const started = deferred()
    mock.onWrite = async (path) => {
      if (!path.includes('/manifest-')) return
      started.resolve()
      await blocked.promise
    }
    await mockCacheFiles(mock)
    const cache = createTauriDownloadedFontCache()
    const data = new Uint8Array([7, 8, 9]).buffer
    const writing = cache.write('Visible', 'Regular', data)
    await started.promise
    let readSettled = false
    const reading = cache.read('Visible', 'Regular').then((value) => {
      readSettled = true
      return value
    })

    await Promise.resolve()
    expect(readSettled).toBe(false)
    blocked.resolve()

    await expect(writing).resolves.toBeUndefined()
    await expect(reading).resolves.toEqual(data)
  })

  test('abort after manifest commit returns success', async () => {
    const mock: CacheFileMock = { files: new Map() }
    const controller = new AbortController()
    mock.onRename = () => controller.abort()
    await mockCacheFiles(mock)
    const cache = createTauriDownloadedFontCache()
    const data = new Uint8Array([10, 11, 12]).buffer

    await expect(
      cache.write('Committed', 'Regular', data, controller.signal)
    ).resolves.toBeUndefined()
    await expect(cache.read('Committed', 'Regular')).resolves.toEqual(data)
  })

  test('failed replacement never deletes bytes referenced by current manifest', async () => {
    const mock: CacheFileMock = { files: new Map() }
    await mockCacheFiles(mock)
    const cache = createTauriDownloadedFontCache()
    const data = new Uint8Array([13, 14, 15]).buffer
    await cache.write('Rollback', 'Regular', data)
    const file = Object.values(manifest(mock)?.entries ?? {})[0]?.file
    mock.onWrite = (path) => {
      if (path.includes('/manifest-')) throw new Error('manifest failed')
    }

    await expect(cache.write('Rollback', 'Regular', data)).rejects.toThrow('manifest failed')
    expect(file && mock.files.has(`cache/v1/font-cache/v1/files/${file}`)).toBe(true)
    await expect(cache.read('Rollback', 'Regular')).resolves.toEqual(data)
  })
})
