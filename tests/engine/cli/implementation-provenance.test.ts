import { expect, setDefaultTimeout, test } from 'bun:test'
import {
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  unlink
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

setDefaultTimeout(120_000)

const repositoryRoot = resolve(import.meta.dirname, '../../..')

async function run(command: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])
  if (exitCode !== 0) throw new Error(`${command.join(' ')} failed: ${stderr || stdout}`)
}

async function linkExternalDependencies(source: string, target: string): Promise<void> {
  let entries
  try {
    entries = await readdir(source, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await mkdir(target, { recursive: true })
  for (const entry of entries) {
    if (entry.name === '@open-pencil' || entry.name === '.bin') continue
    const sourceEntry = join(source, entry.name)
    const targetEntry = join(target, entry.name)
    if (!entry.name.startsWith('@')) {
      await symlink(sourceEntry, targetEntry)
      continue
    }
    await mkdir(targetEntry)
    for (const scoped of await readdir(sourceEntry)) {
      await symlink(join(sourceEntry, scoped), join(targetEntry, scoped))
    }
  }
}

async function linkWorkspaceDependency(
  root: string,
  fromPackage: string,
  toPackage: string
): Promise<void> {
  const scope = join(root, 'packages', fromPackage, 'node_modules/@open-pencil')
  await mkdir(scope, { recursive: true })
  await symlink(join(root, 'packages', toPackage), join(scope, toPackage))
}

async function createSourceProvenanceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'open-pencil-provenance-topology-'))
  const packageNames = ['cli', 'core', 'dom-css', 'kiwi']
  for (const packageName of packageNames) {
    for (const runtimePath of ['package.json', 'src', 'bin', 'assets']) {
      const source = join(repositoryRoot, 'packages', packageName, runtimePath)
      const target = join(root, 'packages', packageName, runtimePath)
      try {
        await cp(source, target, { recursive: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await linkExternalDependencies(
      join(repositoryRoot, 'packages', packageName, 'node_modules'),
      join(root, 'packages', packageName, 'node_modules')
    )
  }
  await linkWorkspaceDependency(root, 'cli', 'core')
  await linkWorkspaceDependency(root, 'cli', 'dom-css')
  await linkWorkspaceDependency(root, 'core', 'kiwi')
  await linkWorkspaceDependency(root, 'dom-css', 'core')
  await run(['git', 'init', '--quiet'], root)
  await Bun.write(join(root, '.git/info/exclude'), 'node_modules\n')
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
  return root
}

async function replaceLink(locator: string, target: string): Promise<void> {
  await unlink(locator)
  await symlink(target, locator)
}

test('source provenance does not refresh the Git index', async () => {
  const root = await createSourceProvenanceRoot()
  try {
    const { captureImplementationProvenance } = await import('#cli/implementation-provenance')
    const indexPath = join(root, '.git/index')
    const sourcePath = join(root, 'packages/core/src/constants.ts')
    const sourceStats = await stat(sourcePath)
    const indexBefore = await stat(indexPath, { bigint: true })

    await utimes(sourcePath, sourceStats.atime, new Date(sourceStats.mtimeMs + 1_000))
    await captureImplementationProvenance(root)

    const indexAfter = await stat(indexPath, { bigint: true })
    expect(indexAfter.mtimeNs).toBe(indexBefore.mtimeNs)
    expect(indexAfter.ctimeNs).toBe(indexBefore.ctimeNs)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('implementation digest binds dependency edges, not only package byte multiset', async () => {
  const root = await createSourceProvenanceRoot()
  try {
    const { captureImplementationProvenance } = await import('#cli/implementation-provenance')
    const coreLocator = join(root, 'packages/core/node_modules/fflate')
    const kiwiLocator = join(root, 'packages/kiwi/node_modules/fflate')
    const firstCopy = join(root, 'fflate-a')
    const secondCopy = join(root, 'fflate-b')
    await cp(await realpath(coreLocator), firstCopy, { recursive: true })
    await cp(await realpath(coreLocator), secondCopy, { recursive: true })
    await replaceLink(coreLocator, firstCopy)
    await replaceLink(kiwiLocator, secondCopy)
    const first = await captureImplementationProvenance(root)
    await replaceLink(coreLocator, secondCopy)
    await replaceLink(kiwiLocator, firstCopy)
    const second = await captureImplementationProvenance(root)

    expect(second.digest).not.toBe(first.digest)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('provenance rejects nested dependency roots that shadow runtime imports', async () => {
  const root = await createSourceProvenanceRoot()
  try {
    const { captureImplementationProvenance } = await import('#cli/implementation-provenance')
    const shadowRoot = join(root, 'packages/kiwi/src/fig/node_modules')
    await mkdir(shadowRoot)
    await symlink(
      await realpath(join(root, 'packages/kiwi/node_modules/fflate')),
      join(shadowRoot, 'fflate')
    )

    await expect(captureImplementationProvenance(root)).rejects.toThrow(
      'implementation provenance rejects nested dependency root'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('provenance rejects restored runtime directory ABA after alternate execution', async () => {
  const root = await createSourceProvenanceRoot()
  try {
    const { captureImplementationProvenance, verifyImplementationProvenance } =
      await import('#cli/implementation-provenance')
    const source = join(root, 'packages/core/src')
    const original = join(root, 'original-core-src')
    const alternate = join(root, 'alternate-core-src')
    const marker = join(root, 'alternate-executed')
    await cp(source, alternate, { recursive: true })
    const entry = join(alternate, 'constants.ts')
    await Bun.write(
      entry,
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'executed')\n${await readFile(entry, 'utf8')}`
    )
    const snapshot = await captureImplementationProvenance(root)

    await rename(source, original)
    await rename(alternate, source)
    try {
      await run(
        ['bun', '-e', `await import(${JSON.stringify(join(source, 'constants.ts'))})`],
        root
      )
      expect(await readFile(marker, 'utf8')).toBe('executed')
    } finally {
      await rename(source, alternate)
      await rename(original, source)
    }

    await expect(verifyImplementationProvenance(snapshot)).rejects.toThrow(
      'implementation provenance changed during lint execution'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('provenance rejects multiply linked runtime files', async () => {
  const root = await createSourceProvenanceRoot()
  try {
    const { captureImplementationProvenance } = await import('#cli/implementation-provenance')
    await link(join(root, 'packages/core/src/constants.ts'), join(root, 'constants-hardlink.ts'))
    await expect(captureImplementationProvenance(root)).rejects.toThrow(
      'implementation provenance rejects multiply linked file'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
