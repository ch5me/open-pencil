#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function validate() {
  let matrix, requirements
  try {
    matrix = JSON.parse(readFileSync(join(ROOT, 'config', 'hush-env-matrix.json'), 'utf-8'))
    requirements = JSON.parse(readFileSync(join(ROOT, 'config', 'runtime-requirements.json'), 'utf-8'))
  } catch (err) {
    console.error(`secrets-validate: failed to load config files: ${err.message}`)
    process.exit(1)
  }

  const errors = []
  const canonicalNames = new Set(matrix.map((e) => e.canonicalName))
  for (const stage of ['local', 'staging', 'production']) {
    if (!canonicalNames.has(stage))
      errors.push(`Missing Hush target for stage "${stage}" in hush-env-matrix.json`)
  }

  for (const entry of matrix) {
    if (!entry.hushTargetName) errors.push(`Entry "${entry.canonicalName}" missing hushTargetName`)
    if (!entry.bundleName) errors.push(`Entry "${entry.canonicalName}" missing bundleName`)
    if (!entry.encryptedFilePath) errors.push(`Entry "${entry.canonicalName}" missing encryptedFilePath`)
  }

  if (!Array.isArray(requirements.api)) {
    errors.push('runtime-requirements.json missing "api" array')
  }

  if (errors.length > 0) {
    console.error('secrets-validate: validation errors:')
    for (const err of errors) console.error(`  - ${err}`)
    process.exit(1)
  }
  console.log('secrets-validate: OK')
}

validate()
