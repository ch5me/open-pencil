#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const STAGES = ['local', 'staging', 'production']
const REQUIRED_ENV_KEYS = [
  'stage', 'apiBaseUrl', 'appUrl', 'siteUrl', 'assetBaseUrl',
  'webProject', 'workerName', 'workerEnv', 'd1DatabaseName', 'd1DatabaseId', 'r2Bucket',
]

function validate() {
  const errors = []
  let envTargets, runtimeReqs
  try {
    envTargets = JSON.parse(readFileSync(join(ROOT, 'config', 'environment-targets.json'), 'utf-8'))
    runtimeReqs = JSON.parse(readFileSync(join(ROOT, 'config', 'runtime-requirements.json'), 'utf-8'))
  } catch (err) {
    console.error(`deploy-validate: failed to load config files: ${err.message}`)
    process.exit(1)
  }

  for (const stage of STAGES) {
    const target = envTargets[stage]
    if (!target) { errors.push(`Missing stage "${stage}" in environment-targets.json`); continue }
    for (const key of REQUIRED_ENV_KEYS) {
      if (target[key] === undefined) errors.push(`Missing key "${key}" for stage "${stage}"`)
    }
  }

  const apiSurface = runtimeReqs['api']
  if (!Array.isArray(apiSurface)) {
    errors.push('runtime-requirements.json must have an "api" array')
  } else {
    for (const req of apiSurface) {
      if (!req.name) errors.push(`Runtime requirement missing "name": ${JSON.stringify(req)}`)
      if (req.delivery !== 'secret' && req.delivery !== 'variable')
        errors.push(`Runtime requirement "${req.name}" has invalid delivery "${req.delivery}"`)
      if (!Array.isArray(req.requiredIn))
        errors.push(`Runtime requirement "${req.name}" missing "requiredIn" array`)
    }
  }

  if (errors.length > 0) {
    console.error('deploy-validate: validation errors:')
    for (const err of errors) console.error(`  - ${err}`)
    process.exit(1)
  }
  console.log('deploy-validate: OK')
}

validate()
