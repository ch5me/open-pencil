import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

type PackageJson = {
  name: string
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, unknown>
  [key: string]: unknown
}

const root = resolve(import.meta.dirname, '..')
const h0Path = join(root, 'artifacts/h0-scene-graph-public-contract-receipt.json')
const tarballDir = join(root, 'artifacts/k1-open-pencil-package-tarballs')
const receiptPath = join(root, 'artifacts/k1-open-pencil-package-consumer-receipt.json')
const exportMapPath = join(root, 'artifacts/k1-open-pencil-package-export-map.json')
const lockfilePath = join(root, 'artifacts/k1-open-pencil-package-lockfile.json')
const internalTarballDir = join(tarballDir, 'internal')
const internalRegistry = 'https://npm.ch5.me/'
const h0 = JSON.parse(readFileSync(h0Path, 'utf8')) as {
  sourceBaseline: string
  integratedBase: string
  privatePackageTip: string
  changedPaths: { path: string; sha256: string }[]
  package: {
    name: string
    version: string
    exports: Record<string, unknown>
    exportMapSha256: string
  }
  declarations: Record<string, { path: string; sha256: string }>
}

const packageDirs = ['agent-contracts', 'kiwi', 'pen', 'fig', 'scene-graph', 'core']
const packageNames = packageDirs.map((name) => `@open-pencil/${name}`)
const requiredSceneGraphExports = ['.', './history', './id-allocation', './variables']
const requiredCoreExports = ['./canvas/composition', './canvas/image-editor']

function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function sha512Integrity(bytes: string | Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

function run(command: string, args: string[], cwd = root, env?: NodeJS.ProcessEnv): string {
  return execFileSync(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim()
}

function readPackage(dir: string): PackageJson {
  return JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) as PackageJson
}

function git(args: string[]): string {
  return run('git', args)
}

function gitBytes(args: string[]): Buffer {
  return execFileSync('git', args, { cwd: root })
}

function exportMapSha256(exports: Record<string, unknown>): string {
  return sha256(`${JSON.stringify(exports)}\n`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertNoSymlinks(path: string): void {
  const stat = lstatSync(path)
  assert(!stat.isSymbolicLink(), `symlink found: ${path}`)
  if (!stat.isDirectory()) return
  for (const entry of readdirSync(path)) {
    if (path.endsWith('/node_modules') && entry === '.bin') continue
    assertNoSymlinks(join(path, entry))
  }
}

function scanText(path: string, patterns: RegExp[]): string[] {
  const findings: string[] = []
  const visit = (current: string) => {
    const stat = lstatSync(current)
    if (stat.isSymbolicLink() && current.includes('/node_modules/.bin/')) return
    assert(!stat.isSymbolicLink(), `symlink found during scan: ${current}`)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current)) {
        if (current.endsWith('/node_modules') && entry === '.bin') continue
        visit(join(current, entry))
      }
      return
    }
    if (!/\.(?:[cm]?[jt]sx?|d\.ts)$/.test(current)) return
    const text = readFileSync(current, 'utf8')
    for (const pattern of patterns) {
      if (pattern.test(text)) findings.push(`${current}: ${pattern}`)
    }
  }
  visit(path)
  return findings
}

function packageTarballName(packageJson: PackageJson): string {
  return `${packageJson.name.replace(/^@/, '').replace('/', '-')}-${packageJson.version}.tgz`
}

function packageExportSnapshot(packageJson: PackageJson): Record<string, unknown> {
  return {
    name: packageJson.name,
    version: packageJson.version,
    exports: packageJson.exports ?? {}
  }
}

function tarRead(tarball: string, path: string): Buffer {
  return execFileSync('tar', ['-xOf', tarball, `package/${path}`])
}

function installSpec(tarball: string): string {
  return `file:${tarball}`
}

function writeRegistryConfig(path: string, token: string): void {
  writeFileSync(
    path,
    `@open-pencil:registry=${internalRegistry}\n//npm.ch5.me/:_authToken=${token}\n`
  )
  chmodSync(path, 0o600)
}

function writeConsumerTsconfig(path: string): void {
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ESNext', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ['node', 'vite/client', 'vitest/globals']
        }
      },
      null,
      2
    )}\n`
  )
}

type ServedPackageIdentity = Record<
  string,
  { version: string; packageJsonSha256: string; sourceTarballSha256: string }
>

function installedPackageIdentity(
  consumerRoot: string,
  tarballHashes: Record<string, string>
): ServedPackageIdentity {
  return Object.fromEntries(
    packageNames.map((name) => {
      const packageJsonPath = join(consumerRoot, 'node_modules', ...name.split('/'), 'package.json')
      const packageJsonBytes = readFileSync(packageJsonPath)
      const packageJson = JSON.parse(packageJsonBytes.toString('utf8')) as PackageJson
      return [
        name,
        {
          version: packageJson.version,
          packageJsonSha256: sha256(packageJsonBytes),
          sourceTarballSha256: tarballHashes[name]
        }
      ]
    })
  )
}

function injectServedIdentity(appRoot: string, identity: ServedPackageIdentity): string {
  const digest = sha256(JSON.stringify(identity))
  const indexPath = join(appRoot, 'index.html')
  const html = readFileSync(indexPath, 'utf8')
  assert(html.includes('</head>'), 'consumer app index is missing </head>')
  writeFileSync(
    indexPath,
    html.replace('</head>', `  <meta name="ch5-k1-package-identity" content="${digest}">\n</head>`)
  )
  return digest
}

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object', 'failed to reserve preview port')
  const port = address.port
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

async function waitForHttp(url: string): Promise<{ status: number; body: string }> {
  let lastError: unknown
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url)
      const body = await response.text()
      if (response.ok) return { status: response.status, body }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }
  throw new Error(`preview did not serve ${url}: ${String(lastError)}`)
}

const head = git(['rev-parse', 'HEAD'])
const originMain = git(['rev-parse', 'origin/main'])
const allowedUnpublishedPaths = [
  'artifacts/k1-open-pencil-package-consumer-receipt.json',
  'artifacts/k1-open-pencil-package-export-map.json',
  'artifacts/k1-open-pencil-package-lockfile.json',
  'artifacts/k1-open-pencil-package-tarballs/',
  'scripts/verify-k1-public-package-consumer.ts'
]
for (const path of git(['diff', '--name-only', `${originMain}..${head}`])
  .split('\n')
  .filter(Boolean)) {
  assert(
    allowedUnpublishedPaths.some((allowed) => path === allowed || path.startsWith(allowed)),
    `unpublished non-K1 path found: ${path}`
  )
}
assert(
  git(['merge-base', '--is-ancestor', h0.privatePackageTip, 'HEAD']) === '',
  'H0 package tip is not an ancestor'
)
assert(
  git(['merge-base', '--is-ancestor', h0.privatePackageTip, 'origin/main']) === '',
  'H0 package tip is not integrated on origin/main'
)
assert(
  git(['merge-base', '--is-ancestor', h0.sourceBaseline, h0.privatePackageTip]) === '',
  'H0 package tip does not descend from source baseline'
)

for (const changed of h0.changedPaths) {
  const path = join(root, changed.path)
  assert(existsSync(path), `H0 path missing: ${changed.path}`)
  assert(sha256(readFileSync(path)) === changed.sha256, `H0 path hash drift: ${changed.path}`)
  assert(
    sha256(gitBytes(['show', `${h0.privatePackageTip}:${changed.path}`])) === changed.sha256,
    `H0 path is not bound to package tip: ${changed.path}`
  )
}
const packageAtTip = JSON.parse(
  gitBytes(['show', `${h0.privatePackageTip}:packages/scene-graph/package.json`]).toString('utf8')
) as PackageJson
assert(
  exportMapSha256(packageAtTip.exports ?? {}) === h0.package.exportMapSha256,
  'H0 export-map hash is not bound to package tip'
)

for (const packageDir of packageDirs) {
  run('bun', ['--filter', `@open-pencil/${packageDir}`, 'build'])
}

rmSync(tarballDir, { recursive: true, force: true })
mkdirSync(tarballDir, { recursive: true })
const packageMetadata: Record<
  string,
  { dir: string; packageJson: PackageJson; tarball: string; tarballSha256: string }
> = {}

for (const packageDir of packageDirs) {
  const packageJson = readPackage(`packages/${packageDir}`)
  const destination = join(tarballDir, packageTarballName(packageJson))
  run(
    'bun',
    ['pm', 'pack', '--ignore-scripts', '--destination', tarballDir],
    join(root, `packages/${packageDir}`)
  )
  assert(existsSync(destination), `missing packed tarball: ${destination}`)
  const packedPackageJson = JSON.parse(
    tarRead(destination, 'package.json').toString('utf8')
  ) as PackageJson
  assert(packedPackageJson.name === packageJson.name, `packed name mismatch: ${packageJson.name}`)
  assert(
    packedPackageJson.version === packageJson.version,
    `packed version mismatch: ${packageJson.name}`
  )
  const packedManifest = JSON.stringify(packedPackageJson)
  assert(
    !packedManifest.includes('workspace:'),
    `packed manifest contains workspace dependency: ${packageJson.name}`
  )
  packageMetadata[packageJson.name] = {
    dir: packageDir,
    packageJson: packedPackageJson,
    tarball: relative(root, destination),
    tarballSha256: sha256(readFileSync(destination))
  }
}

const npmToken = process.env.NPM_TOKEN
assert(npmToken, 'NPM_TOKEN is required for the K1 internal-registry lane')
const internalVersion = `${h0.package.version}-r13.${h0.privatePackageTip.slice(0, 9)}`
const internalPackageMetadata: Record<
  string,
  {
    version: string
    tarball: string
    tarballSha256: string
    integrity: string
    publish: 'published' | 'already-present'
  }
> = {}
rmSync(internalTarballDir, { recursive: true, force: true })
mkdirSync(internalTarballDir, { recursive: true })
const npmrcPath = join(mkdtempSync(join(tmpdir(), 'open-pencil-k1-npmrc-')), 'npmrc')
const npmrcDir = dirname(npmrcPath)
const registryEnv = { NPM_CONFIG_USERCONFIG: npmrcPath }
const authenticatedTemporaryDirs = new Set([npmrcDir])

try {
  writeRegistryConfig(npmrcPath, npmToken)
  for (const packageName of packageNames) {
    const metadata = packageMetadata[packageName]
    const staging = mkdtempSync(join(tmpdir(), 'open-pencil-k1-publish-'))
    authenticatedTemporaryDirs.add(staging)
    execFileSync('tar', ['-xzf', join(root, metadata.tarball), '-C', staging])
    const packageRoot = join(staging, 'package')
    const manifestPath = join(packageRoot, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageJson
    manifest.version = internalVersion
    for (const field of ['dependencies', 'devDependencies'] as const) {
      const dependencies = manifest[field]
      if (!dependencies) continue
      for (const dependency of packageNames) {
        if (dependency in dependencies) dependencies[dependency] = internalVersion
      }
    }
    manifest.publishConfig = { registry: internalRegistry, access: 'restricted' }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    run(
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', internalTarballDir],
      packageRoot,
      registryEnv
    )
    const internalTarball = join(internalTarballDir, packageTarballName(manifest))
    assert(existsSync(internalTarball), `missing internal tarball: ${internalTarball}`)
    const integrity = sha512Integrity(readFileSync(internalTarball))
    const view = spawnSync(
      'npm',
      [
        'view',
        `${packageName}@${internalVersion}`,
        'dist.integrity',
        '--registry',
        internalRegistry,
        '--json'
      ],
      { cwd: root, env: { ...process.env, ...registryEnv }, encoding: 'utf8' }
    )
    let publish: 'published' | 'already-present'
    if (view.status === 0 && view.stdout.trim()) {
      const publishedIntegrity = JSON.parse(view.stdout) as string
      assert(
        publishedIntegrity === integrity,
        `internal package integrity drift: ${packageName}@${internalVersion}`
      )
      publish = 'already-present'
    } else {
      const viewFailure = `${view.stdout}\n${view.stderr}`
      assert(
        viewFailure.includes('E404'),
        `internal registry lookup failed for ${packageName}@${internalVersion}: ${viewFailure.trim()}`
      )
      run(
        'npm',
        ['publish', internalTarball, '--registry', internalRegistry, '--tag', 'image-editor-r13'],
        root,
        registryEnv
      )
      publish = 'published'
    }
    internalPackageMetadata[packageName] = {
      version: internalVersion,
      tarball: relative(root, internalTarball),
      tarballSha256: sha256(readFileSync(internalTarball)),
      integrity,
      publish
    }
    rmSync(staging, { recursive: true, force: true })
    authenticatedTemporaryDirs.delete(staging)
  }

  const packedSceneGraph = packageMetadata['@open-pencil/scene-graph'].packageJson
  for (const exportName of requiredSceneGraphExports) {
    const exportEntry = packedSceneGraph.exports?.[exportName] as
      | { types?: string; import?: string }
      | undefined
    assert(exportEntry, `missing scene-graph export: ${exportName}`)
    for (const target of [exportEntry.types, exportEntry.import]) {
      if (target) tarRead(join(root, packageMetadata['@open-pencil/scene-graph'].tarball), target)
    }
  }
  const sceneGraphTarball = join(root, packageMetadata['@open-pencil/scene-graph'].tarball)
  assert(
    sha256(tarRead(sceneGraphTarball, 'dist/index.d.ts')) === h0.declarations.root.sha256,
    'packed root declaration hash mismatch'
  )
  assert(
    sha256(tarRead(sceneGraphTarball, 'dist/variables.d.ts')) === h0.declarations.variables.sha256,
    'packed variables declaration hash mismatch'
  )
  assert(
    sha256(tarRead(sceneGraphTarball, 'dist/history.d.ts')) === h0.declarations.history.sha256,
    'packed history declaration hash mismatch'
  )
  assert(
    sha256(tarRead(sceneGraphTarball, 'dist/id-allocation.d.ts')) ===
      h0.declarations.idAllocation.sha256,
    'packed ID allocation declaration hash mismatch'
  )

  const packedCore = packageMetadata['@open-pencil/core'].packageJson
  for (const exportName of requiredCoreExports) {
    const exportEntry = packedCore.exports?.[exportName] as
      | { types?: string; import?: string }
      | undefined
    assert(exportEntry, `missing core export: ${exportName}`)
    for (const target of [exportEntry.types, exportEntry.import]) {
      if (target) tarRead(join(root, packageMetadata['@open-pencil/core'].tarball), target)
    }
  }

  const consumer = resolve(mkdtempSync(join(tmpdir(), 'open-pencil-k1-consumer-')))
  const consumerApp = join(consumer, 'apps/image-editor')
  mkdirSync(join(consumer, 'apps'), { recursive: true })
  cpSync(join(root, 'apps/image-editor'), consumerApp, { recursive: true })
  writeConsumerTsconfig(join(consumer, 'tsconfig.json'))
  const appPackage = JSON.parse(
    readFileSync(join(consumerApp, 'package.json'), 'utf8')
  ) as PackageJson
  const consumerDependencies = { ...(appPackage.dependencies ?? {}) }
  const consumerOverrides: Record<string, string> = {}
  for (const name of packageNames) {
    const metadata = packageMetadata[name]
    const spec = installSpec(join(root, metadata.tarball))
    consumerDependencies[name] = spec
    consumerOverrides[name] = spec
  }
  appPackage.dependencies = consumerDependencies
  writeFileSync(join(consumerApp, 'package.json'), `${JSON.stringify(appPackage, null, 2)}\n`)
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify(
      {
        name: 'open-pencil-k1-consumer',
        private: true,
        type: 'module',
        dependencies: consumerDependencies,
        overrides: consumerOverrides,
        devDependencies: appPackage.devDependencies
      },
      null,
      2
    )}\n`
  )

  run('bun', ['install', '--no-progress'], consumer)
  const lockPath = join(consumer, 'bun.lock')
  assert(existsSync(lockPath), 'consumer lockfile missing')
  const lockBytes = readFileSync(lockPath)
  const lockText = lockBytes.toString('utf8')
  assert(!lockText.includes('workspace:'), 'consumer lockfile contains workspace dependency')
  assert(!lockText.includes('link:'), 'consumer lockfile contains link dependency')
  assertNoSymlinks(join(consumer, 'node_modules'))

  const privateImportPatterns = [
    /@open-pencil\/[^'"\s]+\/src(?:\/|['"])/,
    /#core\//,
    /(?:\.\.\/)+open-pencil/,
    /@open-pencil\/vue/,
    /from ['"](?:\.\.\/)+packages\//
  ]
  const privateImportFindings = [
    ...scanText(join(consumerApp, 'src'), privateImportPatterns),
    ...scanText(join(consumer, 'node_modules'), privateImportPatterns)
  ]
  assert(
    privateImportFindings.length === 0,
    `private import(s) found:\n${privateImportFindings.join('\n')}`
  )
  const packedPackageIdentity = installedPackageIdentity(
    consumer,
    Object.fromEntries(packageNames.map((name) => [name, packageMetadata[name].tarballSha256]))
  )
  const packedIdentityDigest = injectServedIdentity(consumerApp, packedPackageIdentity)

  const runRuntime = (consumerRoot: string, runtime: 'bun' | 'node') => {
    const source = `
    import { SceneGraph } from '@open-pencil/scene-graph';
    import { createHistoryState, planHistoryRecord } from '@open-pencil/scene-graph/history';
    import { SceneGraphIdAllocator } from '@open-pencil/scene-graph/id-allocation';
    import { createCompositionPlan } from '@open-pencil/core/canvas/composition';
    const graph = new SceneGraph();
    const history = planHistoryRecord(createHistoryState(2), {
      id: 'history:k1',
      label: 'K1',
      before: graph.rootId,
      after: graph.rootId
    });
    const allocator = new SceneGraphIdAllocator();
    const allocated = allocator.allocate();
    const collection = graph.createCollection('K1');
    const variable = graph.createVariable('K1', 'STRING', collection.id, 'ok');
    if (!graph.nodes.has(graph.rootId) || history.next.undoEntryIds.length !== 1 || allocated !== '0:1' || !variable.id || typeof createCompositionPlan !== 'function') {
      throw new Error('K1 runtime contract failed');
    }
    console.log(JSON.stringify({ rootId: graph.rootId, history: history.next.undoEntryIds, variableId: variable.id }));
  `
    run(
      runtime,
      runtime === 'bun' ? ['-e', source] : ['--input-type=module', '-e', source],
      consumerRoot
    )
  }
  runRuntime(consumer, 'bun')
  runRuntime(consumer, 'node')

  run('bunx', ['tsc', '--noEmit', '-p', 'apps/image-editor/tsconfig.json'], consumer)
  run(
    'bun',
    ['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/image-editor/vite.config.ts'],
    consumer
  )

  async function serveConsumer(
    consumerRoot: string
  ): Promise<{ url: string; status: number; body: string }> {
    const port = await reservePort()
    const url = `http://127.0.0.1:${port}/`
    const preview = spawn(
      'bun',
      [
        'node_modules/vite/bin/vite.js',
        'preview',
        '--config',
        'apps/image-editor/vite.config.ts',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort'
      ],
      { cwd: consumerRoot, stdio: ['ignore', 'ignore', 'inherit'] }
    )
    try {
      const served = await waitForHttp(url)
      assert(served.body.includes('<div id="root">'), 'served app shell is missing #root')
      return { url, ...served }
    } finally {
      preview.kill('SIGTERM')
      await new Promise<void>((resolve) => preview.once('exit', () => resolve()))
    }
  }
  const packedServed = await serveConsumer(consumer)
  assert(
    packedServed.body.includes(`content="${packedIdentityDigest}"`),
    'packed package identity was not observed in served HTML'
  )

  const internalConsumer = resolve(mkdtempSync(join(tmpdir(), 'open-pencil-k1-internal-consumer-')))
  const internalConsumerApp = join(internalConsumer, 'apps/image-editor')
  mkdirSync(join(internalConsumer, 'apps'), { recursive: true })
  cpSync(join(root, 'apps/image-editor'), internalConsumerApp, { recursive: true })
  writeConsumerTsconfig(join(internalConsumer, 'tsconfig.json'))
  const internalAppPackage = JSON.parse(
    readFileSync(join(internalConsumerApp, 'package.json'), 'utf8')
  ) as PackageJson
  const internalDependencies = { ...(internalAppPackage.dependencies ?? {}) }
  const internalOverrides: Record<string, string> = {}
  for (const name of packageNames) {
    internalDependencies[name] = internalVersion
    internalOverrides[name] = internalVersion
  }
  internalAppPackage.dependencies = internalDependencies
  writeFileSync(
    join(internalConsumerApp, 'package.json'),
    `${JSON.stringify(internalAppPackage, null, 2)}\n`
  )
  writeFileSync(
    join(internalConsumer, 'package.json'),
    `${JSON.stringify(
      {
        name: 'open-pencil-k1-internal-consumer',
        private: true,
        type: 'module',
        dependencies: internalDependencies,
        overrides: internalOverrides,
        devDependencies: internalAppPackage.devDependencies
      },
      null,
      2
    )}\n`
  )
  cpSync(npmrcPath, join(internalConsumer, '.npmrc'))
  try {
    run('bun', ['install', '--no-progress'], internalConsumer, registryEnv)
  } finally {
    rmSync(join(internalConsumer, '.npmrc'), { force: true })
  }
  const internalLockPath = join(internalConsumer, 'bun.lock')
  assert(existsSync(internalLockPath), 'internal consumer lockfile missing')
  const internalLockBytes = readFileSync(internalLockPath)
  const internalLockText = internalLockBytes.toString('utf8')
  assert(
    !internalLockText.includes('workspace:'),
    'internal consumer lockfile contains workspace dependency'
  )
  assert(!internalLockText.includes('link:'), 'internal consumer lockfile contains link dependency')
  assert(!internalLockText.includes('file:'), 'internal consumer lockfile contains file dependency')
  assertNoSymlinks(join(internalConsumer, 'node_modules'))
  const internalPackageIdentity = installedPackageIdentity(
    internalConsumer,
    Object.fromEntries(
      packageNames.map((name) => [name, internalPackageMetadata[name].tarballSha256])
    )
  )
  const internalIdentityDigest = injectServedIdentity(internalConsumerApp, internalPackageIdentity)
  runRuntime(internalConsumer, 'bun')
  runRuntime(internalConsumer, 'node')
  run('bunx', ['tsc', '--noEmit', '-p', 'apps/image-editor/tsconfig.json'], internalConsumer)
  run(
    'bun',
    ['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/image-editor/vite.config.ts'],
    internalConsumer
  )
  const internalServed = await serveConsumer(internalConsumer)
  assert(
    internalServed.body.includes(`content="${internalIdentityDigest}"`),
    'internal package identity was not observed in served HTML'
  )

  const exportMap = {
    schema: 'ch5.image-editor.k1-export-map.v1',
    sourceTip: h0.privatePackageTip,
    originMain: git(['rev-parse', 'origin/main']),
    packages: Object.fromEntries(
      packageNames.map((name) => [name, packageExportSnapshot(packageMetadata[name].packageJson)])
    ),
    required: {
      sceneGraph: requiredSceneGraphExports,
      core: requiredCoreExports
    }
  }
  writeFileSync(exportMapPath, `${JSON.stringify(exportMap, null, 2)}\n`)

  writeFileSync(
    lockfilePath,
    `${JSON.stringify(
      {
        schema: 'ch5.image-editor.k1-lockfile.v1',
        sourceTip: h0.privatePackageTip,
        packed: {
          lockfileSha256: sha256(lockBytes),
          lockfile: lockText
        },
        internalRegistry: {
          registry: internalRegistry,
          version: internalVersion,
          lockfileSha256: sha256(internalLockBytes),
          lockfile: internalLockText
        }
      },
      null,
      2
    )}\n`
  )

  const declarations = Object.fromEntries(
    ['root', 'variables', 'history', 'idAllocation'].map((key) => {
      const declaration = h0.declarations[key]
      const path = join(root, declaration.path)
      assert(
        sha256(readFileSync(path)) === declaration.sha256,
        `declaration hash drift: ${declaration.path}`
      )
      return [key, { path: declaration.path, sha256: declaration.sha256 }]
    })
  )
  const receipt = {
    schema: 'ch5.image-editor.k1-package-consumer-receipt.v1',
    nodeId: 'K1',
    status: 'pass',
    recordedAt: new Date().toISOString(),
    repository: {
      repo: 'https://git.ch5.me/ch5/open-pencil.git',
      sourceWorktree: root,
      sourceTip: h0.privatePackageTip,
      originMain: git(['rev-parse', 'origin/main']),
      baseline: h0.sourceBaseline
    },
    h0: {
      receiptPath: 'artifacts/h0-scene-graph-public-contract-receipt.json',
      receiptSha256: sha256(readFileSync(h0Path)),
      integratedBase: h0.integratedBase,
      changedPaths: h0.changedPaths,
      declarations
    },
    packages: packageMetadata,
    consumers: {
      packed: {
        workspaceLinks: false,
        symlinks: false,
        privateImports: false,
        lockfile: 'artifacts/k1-open-pencil-package-lockfile.json#packed',
        lockfileSha256: sha256(lockBytes),
        runtime: { bun: 'pass', node: 'pass' },
        appBuild: 'pass',
        servedIdentity: {
          url: packedServed.url,
          status: packedServed.status,
          htmlSha256: sha256(packedServed.body),
          sourceTip: h0.privatePackageTip,
          packageTarballs: Object.fromEntries(
            packageNames.map((name) => [name, packageMetadata[name].tarballSha256])
          ),
          packageIdentity: packedPackageIdentity,
          packageIdentityDigest: packedIdentityDigest,
          observedFromServedHtml: true,
          result: 'pass'
        },
        temporaryPath: consumer
      },
      internalRegistry: {
        registry: internalRegistry,
        version: internalVersion,
        packages: internalPackageMetadata,
        workspaceLinks: false,
        symlinks: false,
        privateImports: false,
        lockfile: 'artifacts/k1-open-pencil-package-lockfile.json#internalRegistry',
        lockfileSha256: sha256(internalLockBytes),
        runtime: { bun: 'pass', node: 'pass' },
        appBuild: 'pass',
        servedIdentity: {
          url: internalServed.url,
          status: internalServed.status,
          htmlSha256: sha256(internalServed.body),
          sourceTip: h0.privatePackageTip,
          packageVersion: internalVersion,
          packageIdentity: internalPackageIdentity,
          packageIdentityDigest: internalIdentityDigest,
          observedFromServedHtml: true,
          result: 'pass'
        },
        temporaryPath: internalConsumer
      }
    },
    unknown: [
      'external-editor',
      'physical-device',
      'named-assistive-technology',
      'signed-release',
      'deployment',
      'production-user'
    ]
  }
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(
    JSON.stringify(
      {
        status: 'pass',
        receiptPath,
        exportMapPath,
        lockfilePath,
        tarballDir,
        packedConsumer: consumer,
        internalConsumer
      },
      null,
      2
    )
  )
} finally {
  for (const path of authenticatedTemporaryDirs) rmSync(path, { recursive: true, force: true })
}
