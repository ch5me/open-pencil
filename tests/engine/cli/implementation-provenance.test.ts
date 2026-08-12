import { expect, setDefaultTimeout, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  captureImplementationProvenance,
  verifyImplementationProvenance
} from '#cli/implementation-provenance'

setDefaultTimeout(120_000)

async function run(command: string[], cwd: string) {
  const process = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])
  if (exitCode !== 0) throw new Error(`${command.join(' ')} failed: ${stderr || stdout}`)
}

async function writePackage(
  root: string,
  directory: string,
  name: string,
  dependencies: Record<string, string> = {}
) {
  const packageRoot = join(root, 'packages', directory)
  await mkdir(join(packageRoot, 'src'), { recursive: true })
  await Bun.write(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', dependencies })
  )
  await Bun.write(
    join(packageRoot, 'src/index.ts'),
    `export const name = ${JSON.stringify(name)}\n`
  )
}

async function linkWorkspacePackage(root: string, from: string, to: string, name: string) {
  const locator = join(root, 'packages', from, 'node_modules', ...name.split('/'))
  await mkdir(join(locator, '..'), { recursive: true })
  await symlink(join(root, 'packages', to), locator)
}

async function createExternalPackage(root: string, directory: string) {
  const packageRoot = join(root, directory)
  await mkdir(packageRoot)
  await Bun.write(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'runtime-leaf', version: '1.0.0' })
  )
  await Bun.write(join(packageRoot, 'index.js'), 'export const runtimeLeaf = true\n')
  return packageRoot
}

async function replaceLink(locator: string, target: string) {
  await unlink(locator)
  await symlink(target, locator)
}

async function createSourceRoot() {
  const root = await mkdtemp(join(tmpdir(), 'open-pencil-provenance-'))
  await writePackage(root, 'cli', '@open-pencil/cli', {
    '@open-pencil/core': 'workspace:*',
    '@open-pencil/kiwi': 'workspace:*'
  })
  await writePackage(root, 'core', '@open-pencil/core', { 'runtime-leaf': '1.0.0' })
  await writePackage(root, 'kiwi', '@open-pencil/kiwi', { 'runtime-leaf': '1.0.0' })
  await linkWorkspacePackage(root, 'cli', 'core', '@open-pencil/core')
  await linkWorkspacePackage(root, 'cli', 'kiwi', '@open-pencil/kiwi')

  const firstLeaf = await createExternalPackage(root, 'runtime-leaf-a')
  const secondLeaf = await createExternalPackage(root, 'runtime-leaf-b')
  const coreLeaf = join(root, 'packages/core/node_modules/runtime-leaf')
  const kiwiLeaf = join(root, 'packages/kiwi/node_modules/runtime-leaf')
  await mkdir(join(coreLeaf, '..'), { recursive: true })
  await mkdir(join(kiwiLeaf, '..'), { recursive: true })
  await symlink(firstLeaf, coreLeaf)
  await symlink(secondLeaf, kiwiLeaf)

  await run(['git', 'init', '--quiet'], root)
  await Bun.write(join(root, '.git/info/exclude'), 'node_modules\nruntime-leaf-*\n')
  await run(['git', 'add', '.'], root)
  await run(
    [
      'git',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.name=OpenPencil Test',
      '-c',
      'user.email=test@openpencil.local',
      'commit',
      '--quiet',
      '-m',
      'fixture'
    ],
    root
  )
  return { root, firstLeaf, secondLeaf, coreLeaf, kiwiLeaf }
}

test('source provenance leaves the Git index untouched', async () => {
  const fixture = await createSourceRoot()
  try {
    const indexPath = join(fixture.root, '.git/index')
    const sourcePath = join(fixture.root, 'packages/core/src/index.ts')
    const sourceStats = await stat(sourcePath)
    const indexBefore = await stat(indexPath, { bigint: true })

    await utimes(sourcePath, sourceStats.atime, new Date(sourceStats.mtimeMs + 1_000))
    await captureImplementationProvenance(fixture.root)

    const indexAfter = await stat(indexPath, { bigint: true })
    expect(indexAfter.mtimeNs).toBe(indexBefore.mtimeNs)
    expect(indexAfter.ctimeNs).toBe(indexBefore.ctimeNs)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('implementation digest binds dependency edges', async () => {
  const fixture = await createSourceRoot()
  try {
    const first = await captureImplementationProvenance(fixture.root)
    await replaceLink(fixture.coreLeaf, fixture.secondLeaf)
    await replaceLink(fixture.kiwiLeaf, fixture.firstLeaf)
    const second = await captureImplementationProvenance(fixture.root)

    expect(second.digest).not.toBe(first.digest)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('provenance rejects nested dependency roots', async () => {
  const fixture = await createSourceRoot()
  try {
    const nested = join(fixture.root, 'packages/core/src/node_modules')
    await mkdir(nested)
    await symlink(fixture.firstLeaf, join(nested, 'runtime-leaf'))

    await expect(captureImplementationProvenance(fixture.root)).rejects.toThrow(
      'implementation provenance rejects nested dependency root'
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('provenance rejects restored source mutation after capture', async () => {
  const fixture = await createSourceRoot()
  try {
    const snapshot = await captureImplementationProvenance(fixture.root)
    const sourcePath = join(fixture.root, 'packages/core/src/index.ts')
    const original = await readFile(sourcePath)
    await Bun.write(sourcePath, new Uint8Array([...original, 10]))
    await Bun.write(sourcePath, original)

    await expect(verifyImplementationProvenance(snapshot)).rejects.toThrow(
      'implementation provenance changed during lint execution'
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
