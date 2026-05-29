import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const MANIFEST_DIR = '.build-manifests'
const HISTORY_FILE = `${MANIFEST_DIR}/history.json`

function readManifest(stage) {
  const path = `${MANIFEST_DIR}/${stage}.json`
  if (!existsSync(path)) {
    throw new Error(`No recorded manifest for ${stage}. Run release:candidate first.`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readHistory() {
  if (!existsSync(HISTORY_FILE)) {
    return []
  }
  return JSON.parse(readFileSync(HISTORY_FILE, 'utf8'))
}

function writeHistory(history) {
  mkdirSync(MANIFEST_DIR, { recursive: true })
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n')
}

function deployToProduction(manifest) {
  console.log(`Deploying ${manifest.commit} (${manifest.timestamp}) to production...`)

  // Build with production env
  execSync('OPENPENCIL_HOSTED_ENV=production bun run build', {
    stdio: 'inherit'
  })

  // Pages deploy happens in the workflow, not here
  console.log('Production build complete. Pages deploy will be handled by the workflow.')
}

function main() {
  const args = process.argv.slice(2)
  const isPrevious = args.includes('--previous')
  const target = args.find((a) => !a.startsWith('--')) ?? 'production'

  if (target !== 'production') {
    throw new Error(`Only production promotion is supported. Got: ${target}`)
  }

  const history = readHistory()

  if (isPrevious) {
    if (history.length < 2) {
      throw new Error('No previous manifest to rollback to.')
    }
    const previous = history[history.length - 2]
    console.log(`Rolling back to ${previous.commit}...`)
    deployToProduction(previous)
  } else {
    const manifest = readManifest('staging')
    deployToProduction(manifest)

    // Record in history
    history.push({
      ...manifest,
      promotedAt: new Date().toISOString(),
      target: 'production'
    })
    writeHistory(history)
  }

  console.log('Promotion complete.')
}

main()
