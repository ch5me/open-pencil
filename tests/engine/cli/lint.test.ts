import { expect, setDefaultTimeout, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  chmod,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  unlink
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'

import { runOpenPencilCLI } from '#tests/helpers/cli'
import { createRect, firstPageId, makeSceneGraph } from '#tests/helpers/scene'

setDefaultTimeout(120_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)
const digest = `sha256:${'a'.repeat(64)}`
const repositoryRoot = resolve(import.meta.dirname, '../../..')

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)])
  )
}

function canonicalDigest(value: unknown) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`
}

async function createFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'open-pencil-lint-cli-'))
  const documentPath = join(dir, 'design.fig')
  const contextPath = join(dir, 'review-context.json')
  const graph = makeSceneGraph('Review Page')
  createRect(graph, firstPageId(graph), { name: 'Review target' })
  const written = await io.writeDocument('fig', graph)
  const bytes = written.data as Uint8Array
  await Bun.write(documentPath, bytes)
  const tree = await runOpenPencilCLI(['tree', 'design.fig', '--json'], { cwd: dir })
  const nodeId = (JSON.parse(tree.stdout) as Array<{ id: string }>)[0].id
  const context = {
    schema: 'ch5.open-pencil-lint-context/1',
    projectId: 'fixture',
    requestDigest: digest,
    sourceIdentityDigest: digest,
    rulesetContentDigest: digest,
    targetCensus: [
      {
        producerRuleId: 'no-default-names',
        nodeId,
        sourceOccurrenceId: null,
        target: { nodeId: 'source-button', proofTargetKey: digest }
      }
    ],
    documentLocator: 'design.fig',
    documentId: 'document-1',
    revision: 'revision-7'
  }
  await Bun.write(contextPath, `${JSON.stringify(context)}\n`)
  return { dir, documentPath, contextPath, context, nodeId, bytes }
}

async function createPenFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'open-pencil-lint-pen-cli-'))
  const documentPath = join(dir, 'design.pen')
  const contextPath = join(dir, 'review-context.json')
  const bytes = new Uint8Array(
    await readFile(join(import.meta.dir, '../../fixtures/pencil_simple.pen'))
  )
  await Bun.write(documentPath, bytes)
  const tree = await runOpenPencilCLI(['tree', 'design.pen', '--json'], { cwd: dir })
  const nodeId = (JSON.parse(tree.stdout) as Array<{ id: string }>)[0].id
  const context = {
    schema: 'ch5.open-pencil-lint-context/1',
    projectId: 'fixture',
    requestDigest: digest,
    sourceIdentityDigest: digest,
    rulesetContentDigest: digest,
    targetCensus: [
      {
        producerRuleId: 'no-default-names',
        nodeId,
        sourceOccurrenceId: null,
        target: { nodeId: 'source-page', proofTargetKey: digest }
      }
    ],
    documentLocator: 'design.pen'
  }
  await Bun.write(contextPath, `${JSON.stringify(context)}\n`)
  return { dir, contextPath, bytes }
}

test('lint emits strict CH5 v3 receipt bound to stable document bytes and context', async () => {
  const fixture = await createFixture()
  const result = await runOpenPencilCLI(
    ['lint', 'design.fig', '--ch5-review-context', fixture.contextPath],
    { cwd: fixture.dir }
  )

  expect(result.stderr).toBe('')
  expect(result.exitCode).toBe(0)
  const receipt = JSON.parse(result.stdout)
  expect(receipt).toMatchObject({
    schema: 'ch5.open-pencil-lint/3',
    projectId: fixture.context.projectId,
    requestDigest: fixture.context.requestDigest,
    sourceIdentityDigest: fixture.context.sourceIdentityDigest,
    rulesetContentDigest: fixture.context.rulesetContentDigest,
    targetCensus: fixture.context.targetCensus,
    documentLocator: fixture.context.documentLocator,
    document: {
      format: 'fig',
      sha256: `sha256:${createHash('sha256').update(fixture.bytes).digest('hex')}`,
      byteLength: fixture.bytes.byteLength,
      documentId: fixture.context.documentId,
      revision: fixture.context.revision
    },
    producer: {
      name: '@open-pencil/cli',
      version: expect.any(String),
      implementationDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
    },
    startedAt: expect.any(String),
    finishedAt: expect.any(String),
    messages: expect.any(Array),
    errorCount: 0,
    warningCount: 0,
    infoCount: 0
  })
  expect(receipt.checkedNodes).toHaveLength(1)
  expect(receipt.checkedNodes).toEqual(
    [...receipt.checkedNodes].sort(
      (a: { ruleId: string; nodeId: string }, b: { ruleId: string; nodeId: string }) =>
        a.ruleId.localeCompare(b.ruleId) || a.nodeId.localeCompare(b.nodeId)
    )
  )
  expect(receipt.checkedNodes).toContainEqual({
    ruleId: 'no-default-names',
    nodeId: fixture.nodeId
  })
  expect(receipt.executionDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
  expect(receipt.executedMappings).toEqual([
    { producerRuleId: 'no-default-names', nodeId: fixture.nodeId }
  ])
  expect(receipt.executionDigest).toBe(
    canonicalDigest({
      document: receipt.document,
      rulesetContentDigest: fixture.context.rulesetContentDigest,
      mappings: fixture.context.targetCensus
    })
  )
})

test('CH5 receipt accepts equals-form review context argument', async () => {
  const fixture = await createFixture()
  const result = await runOpenPencilCLI(
    ['lint', 'design.fig', `--ch5-review-context=${fixture.contextPath}`],
    { cwd: fixture.dir }
  )

  expect(result.stderr).toBe('')
  expect(result.exitCode).toBe(0)
  const receipt = JSON.parse(result.stdout)
  expect(receipt.schema).toBe('ch5.open-pencil-lint/3')
  expect(receipt.producer.implementationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
})

test('CH5 receipt binds stable .pen bytes', async () => {
  const fixture = await createPenFixture()
  const result = await runOpenPencilCLI(
    ['lint', 'design.pen', '--ch5-review-context', fixture.contextPath],
    { cwd: fixture.dir }
  )

  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout).document).toEqual({
    format: 'pen',
    sha256: `sha256:${createHash('sha256').update(fixture.bytes).digest('hex')}`,
    byteLength: fixture.bytes.byteLength
  })
})

test('CH5 context rejects source bindings, invalid XOR, and duplicate mappings', async () => {
  const fixture = await createFixture()
  const sourceBinding = {
    ...fixture.context.targetCensus[0],
    sourceOccurrenceId: digest,
    target: null
  }
  await Bun.write(
    fixture.contextPath,
    JSON.stringify({
      ...fixture.context,
      targetCensus: [sourceBinding]
    })
  )
  const rejectedSource = await runOpenPencilCLI(
    ['lint', 'design.fig', '--ch5-review-context', fixture.contextPath],
    { cwd: fixture.dir }
  )
  expect(rejectedSource.exitCode).not.toBe(0)
  expect(rejectedSource.stderr).toContain('OpenPencil emits design-lint evidence only')

  await Bun.write(
    fixture.contextPath,
    JSON.stringify({
      ...fixture.context,
      targetCensus: [{ ...fixture.context.targetCensus[0], sourceOccurrenceId: digest }]
    })
  )
  const xor = await runOpenPencilCLI(
    ['lint', 'design.fig', '--ch5-review-context', fixture.contextPath],
    { cwd: fixture.dir }
  )
  expect(xor.exitCode).not.toBe(0)
  expect(xor.stderr).toContain('exactly one sourceOccurrenceId or target')

  await Bun.write(
    fixture.contextPath,
    JSON.stringify({
      ...fixture.context,
      targetCensus: [fixture.context.targetCensus[0], fixture.context.targetCensus[0]]
    })
  )
  const duplicate = await runOpenPencilCLI(
    ['lint', 'design.fig', '--ch5-review-context', fixture.contextPath],
    { cwd: fixture.dir }
  )
  expect(duplicate.exitCode).not.toBe(0)
  expect(duplicate.stderr).toContain('duplicate entries')
})

test('CH5 receipt rejects unbound lint configuration overrides', async () => {
  const fixture = await createFixture()
  for (const override of [
    ['--preset', 'strict'],
    ['--rule', 'no-default-names']
  ]) {
    const result = await runOpenPencilCLI(
      ['lint', 'design.fig', ...override, '--ch5-review-context', fixture.contextPath],
      { cwd: fixture.dir }
    )
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('fixed recommended preset')
  }
})

test('CH5 receipt mode rejects --list-rules instead of bypassing receipt output', async () => {
  const fixture = await createFixture()
  const result = await runOpenPencilCLI(
    ['lint', 'design.fig', '--list-rules', '--ch5-review-context', fixture.contextPath],
    { cwd: fixture.dir }
  )

  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toContain('--list-rules cannot be combined with --ch5-review-context')
  expect(result.stdout).not.toContain('Available rules')
})

test('CH5 receipt rejects target mappings that were not executed', async () => {
  const fixture = await createFixture()
  await Bun.write(
    fixture.contextPath,
    JSON.stringify({
      ...fixture.context,
      targetCensus: [{ ...fixture.context.targetCensus[0], producerRuleId: 'not-a-lint-rule' }]
    })
  )
  const result = await runOpenPencilCLI(
    ['lint', 'design.fig', '--ch5-review-context', fixture.contextPath],
    { cwd: fixture.dir }
  )
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toContain('lint target rule is not enabled')
})

test('normal lint --json output remains unchanged', async () => {
  const fixture = await createFixture()
  const result = await runOpenPencilCLI([
    'lint',
    fixture.documentPath,
    '--rule',
    'no-default-names',
    '--json'
  ])

  expect(result.exitCode).toBe(0)
  expect(Object.keys(JSON.parse(result.stdout)).sort()).toEqual([
    'errorCount',
    'infoCount',
    'messages',
    'warningCount'
  ])
})

test('CH5 receipt rejects consumer-invalid document locators', async () => {
  const fixture = await createFixture()
  for (const documentLocator of [
    '/design.pen',
    './design.pen',
    'design/../button.pen',
    'design//button.pen',
    'design\\button.pen',
    'design/%2e%2e/button.pen',
    'design／button.pen',
    'design/．．/button.pen',
    'C:/design.pen'
  ]) {
    await Bun.write(fixture.contextPath, JSON.stringify({ ...fixture.context, documentLocator }))
    const result = await runOpenPencilCLI(
      ['lint', 'design.fig', '--ch5-review-context', fixture.contextPath],
      { cwd: fixture.dir }
    )

    expect(result.exitCode, documentLocator).not.toBe(0)
    expect(result.stderr).toContain('canonical project-relative POSIX')
  }
})

test('CH5 receipt rejects unknown context fields separately from locator validation', async () => {
  const fixture = await createFixture()
  await Bun.write(
    fixture.contextPath,
    JSON.stringify({
      ...fixture.context,
      extra: true
    })
  )
  const result = await runOpenPencilCLI(
    ['lint', 'design.fig', '--ch5-review-context', fixture.contextPath],
    { cwd: fixture.dir }
  )

  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toContain('unsupported field(s): extra')
})

test('CH5 receipt rejects whitespace-only identity fields', async () => {
  const fixture = await createFixture()
  const entry = fixture.context.targetCensus[0]
  const cases = [
    ['projectId', { ...fixture.context, projectId: ' ' }],
    ['documentId', { ...fixture.context, documentId: '\t' }],
    ['revision', { ...fixture.context, revision: '\n' }],
    [
      'producerRuleId',
      {
        ...fixture.context,
        targetCensus: [{ ...entry, producerRuleId: ' ' }]
      }
    ],
    [
      'nodeId',
      {
        ...fixture.context,
        targetCensus: [{ ...entry, nodeId: '\t' }]
      }
    ],
    [
      'target.nodeId',
      {
        ...fixture.context,
        targetCensus: [{ ...entry, target: { ...entry.target, nodeId: '\n' } }]
      }
    ]
  ] as const

  for (const [label, context] of cases) {
    await Bun.write(fixture.contextPath, JSON.stringify(context))
    const result = await runOpenPencilCLI(
      ['lint', 'design.fig', '--ch5-review-context', fixture.contextPath],
      { cwd: fixture.dir }
    )
    expect(result.exitCode, label).not.toBe(0)
    expect(result.stderr).toContain('must be a non-empty string')
  }
})

test('CH5 receipt rejects linked document inputs', async () => {
  const fixture = await createFixture()
  const linkedPath = join(fixture.dir, 'linked.fig')
  await link(fixture.documentPath, linkedPath)
  await Bun.write(
    fixture.contextPath,
    JSON.stringify({ ...fixture.context, documentLocator: 'linked.fig' })
  )
  const hardlink = await runOpenPencilCLI(
    ['lint', 'linked.fig', '--ch5-review-context', fixture.contextPath],
    { cwd: fixture.dir }
  )
  expect(hardlink.exitCode).not.toBe(0)
  expect(hardlink.stderr).toContain('unsafe hard links')

  await symlink(fixture.documentPath, join(fixture.dir, 'symlink.fig'))
  await Bun.write(
    fixture.contextPath,
    JSON.stringify({ ...fixture.context, documentLocator: 'symlink.fig' })
  )
  const symlinked = await runOpenPencilCLI(
    ['lint', 'symlink.fig', '--ch5-review-context', fixture.contextPath],
    { cwd: fixture.dir }
  )
  expect(symlinked.exitCode).not.toBe(0)
})

async function run(command: string[], cwd: string): Promise<string> {
  const process = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])
  if (exitCode !== 0) throw new Error(`${command.join(' ')} failed: ${stderr || stdout}`)
  return stdout.trim()
}

async function linkExternalDependencies(
  source: string,
  target: string,
  copied: ReadonlySet<string> = new Set()
): Promise<void> {
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
      if (copied.has(entry.name)) {
        await cp(await realpath(sourceEntry), targetEntry, { recursive: true })
      } else {
        await symlink(sourceEntry, targetEntry)
      }
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

async function createPackedCliInstallation() {
  const root = await mkdtemp(join(repositoryRoot, 'packages/cli/.packed-test-'))
  const tarballs = join(root, 'tarballs')
  await mkdir(tarballs)
  await run(['bun', 'run', 'build:packages'], repositoryRoot)

  for (const packageDir of ['packages/kiwi', 'packages/core', 'packages/dom-css', 'packages/cli']) {
    const output = await run(
      ['bun', 'pm', 'pack', '--destination', tarballs, '--quiet'],
      join(repositoryRoot, packageDir)
    )
    const tarball = output.split('\n').findLast((line) => line.trim().length > 0)
    if (!tarball) throw new Error(`No tarball produced for ${packageDir}`)
    const packageJson = JSON.parse(
      await readFile(join(repositoryRoot, packageDir, 'package.json'), 'utf8')
    ) as { name: string }
    const target = join(root, 'node_modules', ...packageJson.name.split('/'))
    await mkdir(target, { recursive: true })
    await run(
      [
        'tar',
        '-xzf',
        tarball.startsWith('/') ? tarball : join(tarballs, tarball),
        '-C',
        target,
        '--strip-components=1'
      ],
      repositoryRoot
    )
    await linkExternalDependencies(
      join(repositoryRoot, packageDir, 'node_modules'),
      join(target, 'node_modules'),
      packageDir === 'packages/kiwi' ? new Set(['fflate', 'fzstd']) : undefined
    )
  }

  return {
    root,
    cli: join(root, 'node_modules/@open-pencil/cli/bin/openpencil.js'),
    core: join(root, 'node_modules/@open-pencil/core'),
    fflate: join(root, 'node_modules/@open-pencil/kiwi/node_modules/fflate'),
    fzstd: join(root, 'node_modules/@open-pencil/kiwi/node_modules/fzstd')
  }
}

async function createSourceProvenanceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'open-pencil-provenance-'))
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
  }
  await run(['git', 'init', '--quiet'], root)
  for (const packageName of packageNames) {
    await linkExternalDependencies(
      join(repositoryRoot, 'packages', packageName, 'node_modules'),
      join(root, 'packages', packageName, 'node_modules')
    )
  }
  await linkWorkspaceDependency(root, 'cli', 'core')
  await linkWorkspaceDependency(root, 'cli', 'dom-css')
  await linkWorkspaceDependency(root, 'core', 'kiwi')
  await linkWorkspaceDependency(root, 'dom-css', 'core')
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

test('CH5 provenance rejects source mutation between lint capture and receipt', async () => {
  const root = await createSourceProvenanceRoot()
  try {
    const { captureImplementationProvenance, verifyImplementationProvenance } =
      await import('#cli/implementation-provenance')
    const snapshot = await captureImplementationProvenance(root)
    const rule = join(root, 'packages/core/src/lint/rules/no-default-names.ts')
    const original = await readFile(rule)
    await Bun.write(rule, new Uint8Array([...original, 10]))
    await Bun.write(rule, original)

    await expect(verifyImplementationProvenance(snapshot)).rejects.toThrow(
      'implementation provenance changed during lint execution'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CH5 provenance rejects dependency symlink ABA after alternate execution', async () => {
  const root = await createSourceProvenanceRoot()
  try {
    const { captureImplementationProvenance, verifyImplementationProvenance } =
      await import('#cli/implementation-provenance')
    const snapshot = await captureImplementationProvenance(root)
    const locator = join(root, 'packages/kiwi/node_modules/fflate')
    const originalLink = await readlink(locator)
    const alternate = join(root, 'alternate-fflate')
    const marker = join(root, 'alternate-executed')
    await cp(await realpath(locator), alternate, { recursive: true })
    const alternateEntry = join(alternate, 'lib/node.cjs')
    await chmod(alternateEntry, 0o600)
    await Bun.write(
      alternateEntry,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')\n${await readFile(alternateEntry, 'utf8')}`
    )

    await unlink(locator)
    await symlink(alternate, locator)
    try {
      await run(
        [
          'node',
          '-e',
          "require('node:module').createRequire(process.argv[1])('fflate')",
          join(root, 'packages/kiwi/package.json')
        ],
        root
      )
      expect(await readFile(marker, 'utf8')).toBe('executed')
    } finally {
      await unlink(locator)
      await symlink(originalLink, locator)
    }

    await expect(verifyImplementationProvenance(snapshot)).rejects.toThrow(
      'implementation provenance dependency resolution changed during lint execution'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('packed CLI receipt binds core and parser dependency substitutions', async () => {
  const packed = await createPackedCliInstallation()
  try {
    const manifest = JSON.parse(
      await readFile(join(packed.root, 'node_modules/@open-pencil/cli/package.json'), 'utf8')
    ) as { dependencies: Record<string, string> }
    expect(manifest.dependencies['@open-pencil/core']).not.toContain('workspace:')

    const fixture = await createFixture()
    const invoke = async () => {
      const process = Bun.spawn(
        ['node', packed.cli, 'lint', 'design.fig', '--ch5-review-context', fixture.contextPath],
        { cwd: fixture.dir, stdout: 'pipe', stderr: 'pipe' }
      )
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited
      ])
      expect(exitCode, stderr).toBe(0)
      return JSON.parse(stdout)
    }

    const approved = await invoke()
    expect(approved.producer.implementationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)

    const coreEntry = join(packed.core, 'dist/lint/index.js')
    await Bun.write(coreEntry, `${await readFile(coreEntry, 'utf8')}\n// compatible substitution\n`)
    const coreSubstituted = await invoke()
    expect(coreSubstituted.producer.implementationDigest).not.toBe(
      approved.producer.implementationDigest
    )

    const fflateEntry = join(packed.fflate, 'esm/index.mjs')
    await chmod(fflateEntry, 0o600)
    await Bun.write(
      fflateEntry,
      `${await readFile(fflateEntry, 'utf8')}\n// compatible substitution\n`
    )
    const fflateSubstituted = await invoke()
    expect(fflateSubstituted.producer.implementationDigest).not.toBe(
      coreSubstituted.producer.implementationDigest
    )

    const fzstdEntry = join(packed.fzstd, 'esm/index.mjs')
    await chmod(fzstdEntry, 0o600)
    await Bun.write(
      fzstdEntry,
      `${await readFile(fzstdEntry, 'utf8')}\n// compatible substitution\n`
    )
    const fzstdSubstituted = await invoke()
    expect(fzstdSubstituted.producer.implementationDigest).not.toBe(
      fflateSubstituted.producer.implementationDigest
    )
  } finally {
    await rm(packed.root, { recursive: true, force: true })
  }
})
