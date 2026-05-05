#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { randomBytes } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const { values } = parseArgs({
  options: {
    stage: { type: 'string', default: 'staging' },
  },
})

const stage = values.stage
if (!['staging', 'production'].includes(stage)) {
  console.error(`release-candidate: unknown stage "${stage}"`)
  process.exit(1)
}

const envTargets = JSON.parse(readFileSync(join(ROOT, 'config', 'environment-targets.json'), 'utf-8'))
const target = envTargets[stage]
const candidateId = `op-${stage}-${Date.now()}-${randomBytes(4).toString('hex')}`
const sha = process.env.GITHUB_SHA ?? 'local'

const manifest = {
  candidateId,
  stage,
  sha,
  builtAt: new Date().toISOString(),
  workerName: target.workerName,
  d1DatabaseName: target.d1DatabaseName,
  r2Bucket: target.r2Bucket,
  apiBaseUrl: target.apiBaseUrl,
  appUrl: target.appUrl,
}

const candidatesDir = join(ROOT, '.sisyphus', 'candidates')
mkdirSync(candidatesDir, { recursive: true })
const outPath = join(candidatesDir, `${candidateId}.json`)
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n')

console.log(`release-candidate: created manifest ${candidateId}`)
console.log(`  Written to: ${outPath}`)
console.log(JSON.stringify(manifest, null, 2))
