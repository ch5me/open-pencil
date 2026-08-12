import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

import { DEFAULT_PACKAGES } from './publish-dirs'
import {
  tarballEntries,
  tarballPackageJSON,
  validateTarballBinTargets,
  validateTarballExportTargets
} from './tarballs'

const execFileAsync = promisify(execFile)
export const REGISTRY = 'https://npm.ch5.me/'
export const PUBLISH_ORDER = [
  'scene-graph',
  'kiwi',
  'pen',
  'fig',
  'core',
  'dom-css',
  'mcp',
  'vue',
  'cli'
] as const

export type RegistryLookup = (name: string, version: string) => Promise<string | undefined>

function packageDirectory(name: string) {
  return DEFAULT_PACKAGES.find(({ dir }) => basename(dir) === name)?.dir
}

export async function packageIdentities(root: string) {
  return Promise.all(
    PUBLISH_ORDER.map(async (name) => {
      const dir = packageDirectory(name)
      if (!dir) throw new Error(`Missing publish configuration for ${name}`)
      const packageJSON = JSON.parse(await readFile(join(root, dir, 'package.json'), 'utf8')) as {
        name: string
        version: string
      }
      return { ...packageJSON, dir, shortName: name }
    })
  )
}

export async function registryIntegrity(
  name: string,
  version: string,
  registry = REGISTRY
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'npm',
      ['view', `${name}@${version}`, 'dist.integrity', '--json', '--registry', registry],
      { encoding: 'utf8', timeout: 30_000 }
    )
    const integrity = JSON.parse(stdout)
    if (typeof integrity !== 'string' || integrity.length === 0) {
      throw new Error(`${name}@${version}: registry returned no dist integrity`)
    }
    return integrity
  } catch (error) {
    const failure = error as { code?: number; stderr?: string }
    if (
      failure.code === 1 &&
      /E404|404 Not Found|is not in this registry/u.test(failure.stderr ?? '')
    ) {
      return undefined
    }
    throw error
  }
}

export async function preflightAbsentVersions(
  packages: Awaited<ReturnType<typeof packageIdentities>>,
  lookup: RegistryLookup = registryIntegrity
) {
  const existing: string[] = []
  for (const packageIdentity of packages) {
    if ((await lookup(packageIdentity.name, packageIdentity.version)) !== undefined) {
      existing.push(`${packageIdentity.name}@${packageIdentity.version}`)
    }
  }
  if (existing.length > 0) {
    throw new Error(`Release versions already exist: ${existing.join(', ')}`)
  }
}

export async function tarballIntegrity(tarball: string) {
  return `sha512-${createHash('sha512')
    .update(await readFile(tarball))
    .digest('base64')}`
}

export async function packPublishDirectories(root: string) {
  const packages = await packageIdentities(root)
  const outputDirectory = join(root, '.npm-packages')
  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true })

  const tarballs: string[] = []
  for (const packageIdentity of packages) {
    const publishDirectory = join(root, '.publish', packageIdentity.shortName)
    const { stdout } = await execFileAsync(
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', outputDirectory],
      { cwd: publishDirectory, encoding: 'utf8' }
    )
    const filename = stdout.trim().split('\n').at(-1)
    if (!filename) throw new Error(`No tarball produced for ${packageIdentity.name}`)
    const tarball = join(outputDirectory, filename)
    const manifest = await tarballPackageJSON(tarball)
    if (manifest.name !== packageIdentity.name || manifest.version !== packageIdentity.version) {
      throw new Error(
        `${filename}: packed identity does not match ${packageIdentity.name}@${packageIdentity.version}`
      )
    }
    await validateTarballBinTargets(tarball)
    await validateTarballExportTargets(tarball)
    tarballs.push(tarball)
  }
  return tarballs
}

export async function smokePackedPackages(tarballs: string[]) {
  const directory = await mkdtemp(join(tmpdir(), 'open-pencil-release-smoke-'))
  try {
    await execFileAsync('npm', ['init', '-y'], { cwd: directory })
    await execFileAsync(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs],
      { cwd: directory, timeout: 180_000 }
    )
    await execFileAsync(
      'node',
      [
        '--input-type=module',
        '--eval',
        `import { createCompositionPlan } from '@open-pencil/core/canvas/composition';
import { composeRasterRGBA8 } from '@open-pencil/core/canvas/image-editor';
import { SceneGraph } from '@open-pencil/core/scene-graph';
const node = (entry) => ({ id: entry.id, type: entry.type, name: entry.id, parentId: entry.parentId ?? null, childIds: entry.childIds ?? [], x: 0, y: 0, width: 1, height: 1, rotation: 0, visible: true, opacity: entry.opacity ?? 1, clipsContent: false, blendMode: 'NORMAL', isMask: false, maskType: 'ALPHA', maskIsOutline: false, fills: entry.fills ?? [] });
const outer = node({ id: 'outer', type: 'GROUP', childIds: ['background', 'inner'] });
const background = node({ id: 'background', type: 'IMAGE', parentId: 'outer', fills: [{ type: 'IMAGE', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true, imageHash: 'asset:background' }] });
const inner = node({ id: 'inner', type: 'GROUP', parentId: 'outer', opacity: 0.5, childIds: ['foreground'] });
const foreground = node({ id: 'foreground', type: 'IMAGE', parentId: 'inner', fills: [{ type: 'IMAGE', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true, imageHash: 'asset:foreground' }] });
const revisions = { 'asset:background': { revisionId: 'sha256:background', kind: 'image', metadata: { format: 'rgba8-srgb', width: 1, height: 1 }, bytes: new Uint8Array([0, 0, 0, 255]) }, 'asset:foreground': { revisionId: 'sha256:foreground', kind: 'image', metadata: { format: 'rgba8-srgb', width: 1, height: 1 }, bytes: new Uint8Array([188, 188, 188, 255]) } };
const nodes = new Map([outer, background, inner, foreground].map((entry) => [entry.id, entry]));
const result = composeRasterRGBA8(createCompositionPlan({ rootId: outer.id, getNode: (id) => nodes.get(id) }, outer.id), { getAsset: (id) => revisions[id] ? { assetId: id, revisionId: revisions[id].revisionId } : undefined, getRevision: (id) => Object.values(revisions).find((revision) => revision.revisionId === id) }, { width: 1, height: 1, backend: 'canvas2d' });
if (String([...result.pixels]) !== '137,137,137,255') throw new Error('Packed core pixel mismatch: ' + [...result.pixels]);
if (new SceneGraph().getPages().length !== 1) throw new Error('Packed core scene-graph compatibility failed');`
      ],
      { cwd: directory, timeout: 30_000 }
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function publishTarballs(tarballs: string[]) {
  const byName = new Map<string, string>()
  for (const tarball of tarballs) {
    byName.set((await tarballPackageJSON(tarball)).name, tarball)
  }
  const packages = await packageIdentities(process.cwd())
  for (const packageIdentity of packages) {
    const tarball = byName.get(packageIdentity.name)
    if (!tarball) throw new Error(`Missing exact tarball for ${packageIdentity.name}`)
    const localIntegrity = await tarballIntegrity(tarball)
    const publishedIntegrity = await registryIntegrity(
      packageIdentity.name,
      packageIdentity.version
    )
    if (publishedIntegrity !== undefined) {
      if (publishedIntegrity !== localIntegrity) {
        throw new Error(
          `${packageIdentity.name}@${packageIdentity.version}: registry integrity ${publishedIntegrity} does not match prepared artifact ${localIntegrity}`
        )
      }
      console.log(`${packageIdentity.name}@${packageIdentity.version} already published exactly`)
      continue
    }
    await execFileAsync('npm', ['publish', tarball, '--access', 'public', '--registry', REGISTRY], {
      timeout: 120_000
    })
    const readbackIntegrity = await registryIntegrity(packageIdentity.name, packageIdentity.version)
    if (readbackIntegrity !== localIntegrity) {
      throw new Error(
        `${packageIdentity.name}@${packageIdentity.version}: published integrity readback mismatch`
      )
    }
  }
}

export async function tarballsIn(directory: string) {
  return (await readdir(directory))
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(directory, name))
}

export async function validateExactTarballSet(root: string, tarballs: string[]) {
  const packages = await packageIdentities(root)
  const expected = new Set(packages.map(({ name, version }) => `${name}@${version}`))
  const actual = new Set<string>()
  for (const tarball of tarballs) {
    const entries = await tarballEntries(tarball)
    if (!entries.has('package/package.json'))
      throw new Error(`${tarball}: package manifest missing`)
    const manifest = await tarballPackageJSON(tarball)
    actual.add(`${manifest.name}@${manifest.version}`)
  }
  if (actual.size !== expected.size || [...expected].some((identity) => !actual.has(identity))) {
    throw new Error(
      `Tarball set mismatch: expected ${[...expected].join(', ')}, got ${[...actual].join(', ')}`
    )
  }
}
