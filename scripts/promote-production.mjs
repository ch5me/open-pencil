#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const { values } = parseArgs({
  options: {
    candidate: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
})

if (!values.candidate) {
  console.error('promote-production: --candidate <id> is required')
  process.exit(1)
}

const candidatesDir = join(ROOT, '.sisyphus', 'candidates')
const manifestPath = join(candidatesDir, `${values.candidate}.json`)

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
} catch {
  console.error(`promote-production: candidate manifest not found: ${manifestPath}`)
  const available = readdirSync(candidatesDir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
  if (available.length > 0) console.error(`  Available candidates: ${available.join(', ')}`)
  process.exit(1)
}

if (manifest.stage !== 'staging') {
  console.error(`promote-production: candidate "${values.candidate}" was built for stage "${manifest.stage}", not "staging"`)
  process.exit(1)
}

console.log(`promote-production: promoting candidate ${values.candidate}`)
console.log(`  SHA: ${manifest.sha}`)
console.log(`  Worker: ${manifest.workerName} → openpencil-api (production)`)
console.log(`  D1: ${manifest.d1DatabaseName} → openpencil-db (production)`)

if (values['dry-run']) {
  console.log('promote-production: DRY RUN — no changes applied')
  process.exit(0)
}

console.log('promote-production: deploying to production via wrangler...')
execSync('npx wrangler deploy --env production', { cwd: join(ROOT, 'api'), stdio: 'inherit' })
console.log('promote-production: done')
