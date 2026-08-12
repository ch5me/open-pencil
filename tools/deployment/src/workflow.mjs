import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MANIFEST_DIR = '.build-manifests'
const STAGING_MANIFEST = 'staging.json'
const HISTORY_MANIFEST = 'history.json'

function manifestPath(root, file) {
  return join(root, MANIFEST_DIR, file)
}

function writeJSON(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function recordStagingManifest({
  root = process.cwd(),
  commit,
  branch,
  now = () => new Date()
}) {
  mkdirSync(join(root, MANIFEST_DIR), { recursive: true })

  const manifest = {
    commit,
    branch,
    timestamp: now().toISOString(),
    artifacts: {
      web: 'dist'
    }
  }

  writeJSON(manifestPath(root, STAGING_MANIFEST), manifest)
  return manifest
}

export function readStagingManifest(root = process.cwd()) {
  const path = manifestPath(root, STAGING_MANIFEST)
  if (!existsSync(path)) {
    throw new Error('No recorded manifest for staging. Run release:candidate first.')
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function readPromotionHistory(root = process.cwd()) {
  const path = manifestPath(root, HISTORY_MANIFEST)
  if (!existsSync(path)) {
    return []
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writePromotionHistory(history, root = process.cwd()) {
  mkdirSync(join(root, MANIFEST_DIR), { recursive: true })
  writeJSON(manifestPath(root, HISTORY_MANIFEST), history)
}

export function runBuildCandidate({
  root = process.cwd(),
  now = () => new Date(),
  execute = execSync,
  output = (message) => process.stdout.write(`${message}\n`)
} = {}) {
  const commandOptions = { cwd: root }
  const commit = execute('git rev-parse HEAD', commandOptions).toString().trim()
  const branch = execute('git rev-parse --abbrev-ref HEAD', commandOptions).toString().trim()

  output(`Building staging candidate from ${commit} (${branch})...`)
  recordStagingManifest({ root, commit, branch, now })
  output(`Recorded staging manifest for ${commit} on ${branch}`)
  output('Candidate build complete.')
}

function deployToProduction(manifest, { root, execute, output }) {
  output(`Deploying ${manifest.commit} (${manifest.timestamp}) to production...`)
  execute('OPENPENCIL_HOSTED_ENV=production bun run build', {
    cwd: root,
    stdio: 'inherit'
  })
  output('Production build complete. Pages deploy will be handled by the workflow.')
}

export function runPromotion(
  args,
  {
    root = process.cwd(),
    now = () => new Date(),
    execute = execSync,
    output = (message) => process.stdout.write(`${message}\n`)
  } = {}
) {
  const isPrevious = args.includes('--previous')
  const target = args.find((argument) => !argument.startsWith('--')) ?? 'production'

  if (target !== 'production') {
    throw new Error(`Only production promotion is supported. Got: ${target}`)
  }

  const history = readPromotionHistory(root)

  if (isPrevious) {
    if (history.length < 2) {
      throw new Error('No previous manifest to rollback to.')
    }
    const previous = history.at(-2)
    output(`Rolling back to ${previous.commit}...`)
    deployToProduction(previous, { root, execute, output })
  } else {
    const manifest = readStagingManifest(root)
    deployToProduction(manifest, { root, execute, output })
    history.push({
      ...manifest,
      promotedAt: now().toISOString(),
      target: 'production'
    })
    writePromotionHistory(history, root)
  }

  output('Promotion complete.')
}
