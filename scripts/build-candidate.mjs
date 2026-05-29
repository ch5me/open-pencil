import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'

const MANIFEST_DIR = '.build-manifests'

function getCommit() {
  return execSync('git rev-parse HEAD').toString().trim()
}

function getBranch() {
  return execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
}

function recordManifest(commit, branch) {
  mkdirSync(MANIFEST_DIR, { recursive: true })

  const manifest = {
    commit,
    branch,
    timestamp: new Date().toISOString(),
    artifacts: {
      web: 'dist'
    }
  }

  writeFileSync(`${MANIFEST_DIR}/staging.json`, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Recorded staging manifest for ${commit} on ${branch}`)
}

function main() {
  const commit = getCommit()
  const branch = getBranch()

  console.log(`Building staging candidate from ${commit} (${branch})...`)
  recordManifest(commit, branch)
  console.log('Candidate build complete.')
}

main()
