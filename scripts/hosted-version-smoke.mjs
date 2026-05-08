#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const { values } = parseArgs({
  options: {
    stage: { type: 'string', default: 'staging' },
  },
})

const stage = values.stage
if (stage !== 'staging' && stage !== 'production') {
  console.error(`hosted-version-smoke: unsupported stage "${stage}"`)
  process.exit(1)
}

const targets = JSON.parse(readFileSync(join(ROOT, 'config', 'environment-targets.json'), 'utf-8'))
const target = targets[stage]
if (!target?.apiBaseUrl) {
  console.error(`hosted-version-smoke: missing apiBaseUrl for stage "${stage}"`)
  process.exit(1)
}

const response = await fetch(`${target.apiBaseUrl}/api/version`)
if (!response.ok) {
  console.error(`hosted-version-smoke: request failed with ${response.status} ${response.statusText}`)
  process.exit(1)
}

const data = await response.json()

if (data.version === '0.0.0') {
  console.error('hosted-version-smoke: version fallback 0.0.0 is still live')
  process.exit(1)
}

if (data.deployedAt === 'unknown') {
  console.error('hosted-version-smoke: deployedAt fallback unknown is still live')
  process.exit(1)
}

console.log(JSON.stringify(data, null, 2))
