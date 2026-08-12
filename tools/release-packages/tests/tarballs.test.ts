import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { packageBinTargets, validateTarballExportTargets } from '../src/tarballs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

async function tarballFixture(packageJSON: object, files: Record<string, string>) {
  const root = join(tmpdir(), `open-pencil-tarball-${crypto.randomUUID()}`)
  temporaryDirectories.push(root)
  const packageDirectory = join(root, 'package')
  await mkdir(packageDirectory, { recursive: true })
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify(packageJSON))
  for (const [path, contents] of Object.entries(files)) {
    const target = join(packageDirectory, path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, contents)
  }
  const tarball = join(root, 'fixture.tgz')
  const process = Bun.spawnSync(['tar', '-czf', tarball, '-C', root, 'package'])
  if (!process.success) throw new Error(process.stderr.toString())
  return tarball
}

describe('packageBinTargets', () => {
  test('normalizes string bin fields', () => {
    expect(packageBinTargets({ name: '@open-pencil/cli', bin: './bin/openpencil.js' })).toEqual({
      '@open-pencil/cli': './bin/openpencil.js'
    })
  })

  test('keeps named bin fields', () => {
    expect(
      packageBinTargets({ name: '@open-pencil/cli', bin: { openpencil: './bin/openpencil.js' } })
    ).toEqual({
      openpencil: './bin/openpencil.js'
    })
  })
})

describe('validateTarballExportTargets', () => {
  test('accepts every declared conditional export target', async () => {
    const tarball = await tarballFixture(
      {
        name: '@open-pencil/example',
        version: '1.0.0',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js'
          }
        }
      },
      { 'dist/index.d.ts': 'export {}\n', 'dist/index.js': 'export {}\n' }
    )

    await expect(validateTarballExportTargets(tarball)).resolves.toBeUndefined()
  })

  test('rejects a missing declared export target', async () => {
    const tarball = await tarballFixture(
      {
        name: '@open-pencil/example',
        version: '1.0.0',
        exports: { '.': './dist/missing.js' }
      },
      {}
    )

    await expect(validateTarballExportTargets(tarball)).rejects.toThrow(
      'export . target missing from tarball'
    )
  })
})
