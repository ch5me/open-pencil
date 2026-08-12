import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertG135Output,
  G135_FIXTURE,
  G135_GOLDEN
} from '#tests/helpers/image-editor/g135-production-effect'
import { calculateG135ReferencePixel } from '#tests/helpers/image-editor/g135-reference-oracle'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const artifactDir = resolve(root, 'artifacts/proof/image-editor-g135-production-effect')
const receiptPath = resolve(artifactDir, 'receipt.json')
const distTreePath = resolve(artifactDir, 'core-dist-tree.json')
const boundPaths = {
  generator: 'tools/image-editor-proof/src/g135-production-effect.ts',
  golden: 'tests/helpers/image-editor/g135-production-effect.golden.json',
  fixture: 'tests/helpers/image-editor/g135-production-effect.ts',
  oracleReference: 'tests/helpers/image-editor/g135-reference-oracle.ts',
  test: 'tests/engine/editor/image/raster-composition.test.ts',
  rootManifest: 'package.json',
  lockfile: 'bun.lock',
  packageManifest: 'packages/core/package.json',
  buildConfig: 'packages/core/tsdown.config.ts',
  sourceEntrypoint: 'packages/core/src/canvas/image-editor/index.ts',
  implementation: 'packages/core/src/canvas/image-editor/raster.ts'
} as const
const packageDirs = [
  'packages/scene-graph',
  'packages/pen',
  'packages/kiwi',
  'packages/fig',
  'packages/core'
]
const mutationNeedle = 'const sourceAlpha = source[3] / 255 * opacity;'
const mutationReplacement = 'const sourceAlpha = source[3] / 255;'

type JSONValue = Record<string, unknown>

interface ProductionRun {
  actualRgba8: number[]
  resolvedEntrypoint: string
  resolvedImplementation: string
}

function hash(bytes: string | Uint8Array, algorithm = 'sha256'): string {
  return createHash(algorithm).update(bytes).digest('hex')
}

function run(command: string[], cwd = root): string {
  const result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed: ${result.stderr.toString().trim()}`)
  }
  return result.stdout.toString().trim()
}

function git(...args: string[]): string {
  return run(['git', ...args])
}

async function fileIdentity(
  path: string
): Promise<{ path: string; sha256: string; bytes: number }> {
  const bytes = await readFile(resolve(root, path))
  return { path, sha256: hash(bytes), bytes: bytes.byteLength }
}

async function sourceIdentity(path: string): Promise<{
  path: string
  gitBlob: string
  sha256: string
  bytes: number
}> {
  return { ...(await fileIdentity(path)), gitBlob: git('hash-object', '--', path) }
}

async function proofInputDiffHash(): Promise<string> {
  const tracked = Bun.spawnSync(
    ['git', 'diff', '--binary', 'HEAD', '--', '.', ':(exclude)artifacts'],
    {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe'
    }
  )
  if (tracked.exitCode !== 0) throw new Error(tracked.stderr.toString().trim())
  const untracked = git('ls-files', '--others', '--exclude-standard')
    .split('\n')
    .filter((path) => path && !path.startsWith('artifacts/'))
    .sort()
  const parts = [tracked.stdout]
  for (const path of untracked) {
    parts.push(Buffer.from(`\0${path}\0`), await readFile(resolve(root, path)))
  }
  return hash(Buffer.concat(parts))
}

async function hashTree(directory: string): Promise<{
  entries: Array<{ path: string; sha256: string; bytes: number }>
  sha256: string
}> {
  const paths: string[] = []
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) paths.push(path)
    }
  }
  await visit(directory)
  const entries = await Promise.all(
    paths.sort().map(async (path) => {
      const bytes = await readFile(path)
      return { path: relative(directory, path), sha256: hash(bytes), bytes: bytes.byteLength }
    })
  )
  return { entries, sha256: hash(JSON.stringify(entries)) }
}

function runnerSource(): string {
  return `
    import { createCompositionPlan } from '@open-pencil/core/canvas/composition'
    import { composeRasterRGBA8 } from '@open-pencil/core/canvas/image-editor'

    const fixture = JSON.parse(process.argv[2])
    const node = (overrides) => ({
      id: overrides.id, type: overrides.type, name: overrides.id,
      parentId: overrides.parentId ?? null, childIds: overrides.childIds ?? [],
      x: 0, y: 0, width: 1, height: 1, rotation: 0, visible: true,
      opacity: overrides.opacity ?? 1, clipsContent: false, blendMode: 'NORMAL',
      isMask: false, maskType: 'ALPHA', maskIsOutline: false,
      fills: overrides.fills ?? []
    })
    const outer = node({ id: 'outer', type: 'GROUP', childIds: ['background', 'inner'] })
    const background = node({
      id: 'background', type: 'IMAGE', parentId: outer.id,
      fills: [{ type: 'IMAGE', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1,
        visible: true, imageHash: 'asset:background' }]
    })
    const inner = node({
      id: 'inner', type: 'GROUP', parentId: outer.id,
      opacity: fixture.groupOpacity, childIds: ['foreground']
    })
    const foreground = node({
      id: 'foreground', type: 'IMAGE', parentId: inner.id,
      fills: [{ type: 'IMAGE', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1,
        visible: true, imageHash: 'asset:foreground' }]
    })
    const revisions = {
      'asset:background': {
        revisionId: 'sha256:background', kind: 'image',
        metadata: { format: 'rgba8-srgb', width: 1, height: 1 },
        bytes: new Uint8Array(fixture.backgroundRgba8)
      },
      'asset:foreground': {
        revisionId: 'sha256:foreground', kind: 'image',
        metadata: { format: 'rgba8-srgb', width: 1, height: 1 },
        bytes: new Uint8Array(fixture.foregroundRgba8)
      }
    }
    const nodes = new Map([outer, background, inner, foreground].map((entry) => [entry.id, entry]))
    const result = composeRasterRGBA8(
      createCompositionPlan({ rootId: outer.id, getNode: (id) => nodes.get(id) }, outer.id),
      {
        getAsset: (assetId) => revisions[assetId]
          ? { assetId, revisionId: revisions[assetId].revisionId }
          : undefined,
        getRevision: (revisionId) =>
          Object.values(revisions).find((revision) => revision.revisionId === revisionId)
      },
      { width: fixture.width, height: fixture.height, backend: 'canvas2d' }
    )
    process.stdout.write(JSON.stringify({
      actualRgba8: [...result.pixels],
      resolvedEntrypoint: import.meta.resolve('@open-pencil/core/canvas/image-editor'),
      resolvedImplementation: new URL('./raster.js', import.meta.resolve('@open-pencil/core/canvas/image-editor')).href
    }))
  `
}

async function runInstalled(temp: string, fixture = G135_FIXTURE): Promise<ProductionRun> {
  const runner = resolve(temp, 'g135-runner.mjs')
  await writeFile(runner, runnerSource())
  const output = run(['node', runner, JSON.stringify(fixture)], temp)
  return JSON.parse(output) as ProductionRun
}

async function createProof(): Promise<{ receipt: JSONValue; distTree: JSONValue }> {
  run(['bun', 'run', 'build:packages'])
  const temp = await mkdtemp(join(tmpdir(), 'open-pencil-g135-'))
  try {
    const tarballs: string[] = []
    for (const packageDir of packageDirs) {
      const output = run(
        ['bun', 'pm', 'pack', '--destination', temp, '--quiet'],
        resolve(root, packageDir)
      )
      const filename = output
        .split('\n')
        .findLast((line) => line.trim())
        ?.trim()
      if (!filename) throw new Error(`No tarball produced for ${packageDir}`)
      tarballs.push(filename.startsWith('/') ? filename : resolve(temp, filename))
    }
    const coreTarball = tarballs.find((path) => /open-pencil-core-/.test(path))
    if (!coreTarball) throw new Error('Packed @open-pencil/core tarball missing')
    const coreTarballBytes = await readFile(coreTarball)

    run(['npm', 'init', '-y'], temp)
    run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], temp)
    const installedRoot = resolve(temp, 'node_modules/@open-pencil/core')
    const installedManifest = JSON.parse(
      await readFile(resolve(installedRoot, 'package.json'), 'utf8')
    )
    const installedDist = resolve(installedRoot, 'dist')
    const distTree = await hashTree(installedDist)

    const first = await runInstalled(temp)
    const second = await runInstalled(temp)
    const reference = calculateG135ReferencePixel(
      G135_FIXTURE.backgroundRgba8,
      G135_FIXTURE.foregroundRgba8,
      G135_FIXTURE.groupOpacity
    )
    if (JSON.stringify(reference) !== JSON.stringify(G135_GOLDEN)) {
      throw new Error(`G135 frozen golden disagrees with independent reference: ${reference}`)
    }
    const actual = [...assertG135Output(first.actualRgba8)]
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new Error('G135 installed-package output is nondeterministic')
    }
    const installedRootReal = await realpath(installedRoot)
    const resolvedEntrypointReal = await realpath(fileURLToPath(first.resolvedEntrypoint))
    if (!resolvedEntrypointReal.startsWith(`${installedRootReal}/dist/`)) {
      throw new Error(`G135 entrypoint escaped isolated install: ${first.resolvedEntrypoint}`)
    }

    const implementationURL = new URL(first.resolvedImplementation)
    const implementationBytes = await readFile(implementationURL, 'utf8')
    if (!implementationBytes.includes(mutationNeedle)) {
      throw new Error('G135 compositor mutation target missing from installed implementation')
    }
    await writeFile(
      implementationURL,
      implementationBytes.replace(mutationNeedle, mutationReplacement)
    )
    const mutated = await runInstalled(temp)
    let mutationFailure = ''
    try {
      assertG135Output(mutated.actualRgba8)
    } catch (error) {
      mutationFailure = error instanceof Error ? error.message : String(error)
    }
    if (!mutationFailure) throw new Error('G135 implementation mutation was not rejected')

    const zeroFixture = {
      ...G135_FIXTURE,
      backgroundRgba8: [0, 0, 0, 0],
      foregroundRgba8: [0, 0, 0, 0]
    }
    const zero = await runInstalled(temp, zeroFixture)
    let zeroFailure = ''
    try {
      assertG135Output(zero.actualRgba8)
    } catch (error) {
      zeroFailure = error instanceof Error ? error.message : String(error)
    }
    if (!zeroFailure) throw new Error('G135 zero negative was not rejected')

    const rootManifest = JSON.parse(await readFile(resolve(root, boundPaths.rootManifest), 'utf8'))
    const packageManifest = JSON.parse(
      await readFile(resolve(root, boundPaths.packageManifest), 'utf8')
    )
    const boundInputs = Object.fromEntries(
      await Promise.all(
        Object.entries(boundPaths).map(async ([name, path]) => [name, await sourceIdentity(path)])
      )
    )
    const distManifest: JSONValue = {
      schema: 'ch5.open-pencil.g135-core-dist-tree/1',
      package: { name: installedManifest.name, version: installedManifest.version },
      fileCount: distTree.entries.length,
      sha256: distTree.sha256,
      entries: distTree.entries
    }
    const distManifestBytes = `${JSON.stringify(distManifest, null, 2)}\n`
    const receipt: JSONValue = {
      schema: 'ch5.open-pencil.g135-production-effect/3',
      status: 'PASS',
      identity: {
        repositoryHead: git('rev-parse', 'HEAD'),
        originMain: git('rev-parse', 'origin/main'),
        proofInputDiffSha256: await proofInputDiffHash(),
        productionImplementationCommit: git(
          'log',
          '-1',
          '--format=%H',
          '--',
          boundPaths.implementation
        ),
        runtime: {
          node: process.version,
          bun: Bun.version,
          platform: process.platform,
          arch: process.arch
        },
        backend: 'canvas2d'
      },
      package: {
        name: installedManifest.name,
        version: installedManifest.version,
        tarball: {
          filename: coreTarball.split('/').at(-1),
          sha256: hash(coreTarballBytes),
          integrity: `sha512-${createHash('sha512').update(coreTarballBytes).digest('base64')}`,
          bytes: coreTarballBytes.byteLength
        },
        isolatedInstall: true,
        workspaceResolution: false,
        resolvedEntrypoint: relative(await realpath(temp), resolvedEntrypointReal),
        resolvedImplementation: relative(
          await realpath(temp),
          await realpath(fileURLToPath(first.resolvedImplementation))
        ),
        distTree: {
          path: relative(root, distTreePath),
          artifactSha256: hash(distManifestBytes),
          fileCount: distTree.entries.length,
          sha256: distTree.sha256
        }
      },
      boundInputs,
      manifestBindings: {
        command: rootManifest.scripts?.['proof:g135'],
        packageExport: packageManifest.exports?.['./canvas/image-editor']
      },
      oracle: {
        kind: 'frozen-independent-golden',
        provenanceCommit: '849d81542140791e91b20fe9e486ea59fe7603ff',
        reference: 'IEC 61966-2-1 transfer plus Porter-Duff source-over',
        independentlyCalculatedRgba8: reference,
        expectedRgba8: G135_GOLDEN,
        actualRgba8: actual,
        nonzeroOutput: actual.some((channel) => channel !== 0),
        deterministicRuns: 2
      },
      implementationMutation: {
        status: 'PASS',
        mutation: 'installed compositor ignores inherited group opacity',
        target: 'node_modules/@open-pencil/core/dist/canvas/image-editor/raster.js',
        actualMutatedRgba8: mutated.actualRgba8,
        rejected: true,
        sameOracleFailure: mutationFailure
      },
      zeroNegative: {
        status: 'PASS',
        actualRgba8: zero.actualRgba8,
        rejected: true,
        sameOracleFailure: zeroFailure
      },
      proofBoundary: { browser: 'UNKNOWN', physicalDevice: 'UNKNOWN', externalRenderer: 'UNKNOWN' }
    }
    return { receipt, distTree: distManifest }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

if (process.argv.includes('--check')) {
  const [receiptBytes, distTreeBytes] = await Promise.all([
    readFile(receiptPath),
    readFile(distTreePath)
  ])
  const receipt = JSON.parse(receiptBytes.toString()) as {
    status?: string
    boundInputs?: Record<string, Awaited<ReturnType<typeof sourceIdentity>>>
    package?: { distTree?: { artifactSha256?: string; fileCount?: number; sha256?: string } }
  }
  const distTree = JSON.parse(distTreeBytes.toString()) as {
    entries?: Array<{ path: string; sha256: string; bytes: number }>
    fileCount?: number
    sha256?: string
  }
  if (receipt.status !== 'PASS' || !receipt.boundInputs || !distTree.entries) {
    throw new Error('G135 proof artifacts are invalid')
  }
  for (const [name, path] of Object.entries(boundPaths)) {
    const expected = receipt.boundInputs[name]
    const actual = await sourceIdentity(path)
    if (!expected || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`G135 bound input is stale: ${path}`)
    }
  }
  const distTreeSha256 = hash(JSON.stringify(distTree.entries))
  if (
    distTree.fileCount !== distTree.entries.length ||
    distTree.sha256 !== distTreeSha256 ||
    receipt.package?.distTree?.fileCount !== distTree.entries.length ||
    receipt.package.distTree.sha256 !== distTreeSha256 ||
    receipt.package.distTree.artifactSha256 !== hash(`${JSON.stringify(distTree, null, 2)}\n`)
  ) {
    throw new Error('G135 dist-tree artifact is stale')
  }
  console.log(`G135 packed production-effect proof current: ${relative(root, receiptPath)}`)
} else {
  const proof = await createProof()
  const receiptOutput = `${JSON.stringify(proof.receipt, null, 2)}\n`
  const distTreeOutput = `${JSON.stringify(proof.distTree, null, 2)}\n`
  await mkdir(artifactDir, { recursive: true })
  await Promise.all([
    writeFile(receiptPath, receiptOutput),
    writeFile(distTreePath, distTreeOutput)
  ])
  console.log(`G135 packed production-effect proof written: ${relative(root, receiptPath)}`)
}
