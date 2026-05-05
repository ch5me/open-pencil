#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const { values } = parseArgs({
  options: {
    stage: { type: 'string', default: 'local' },
    surface: { type: 'string', default: 'api' },
  },
})

const stage = values.stage
const surface = values.surface

if (!['local', 'staging', 'production'].includes(stage)) {
  console.error(`runtime-print: unknown stage "${stage}". Valid: local, staging, production`)
  process.exit(1)
}
if (!['api'].includes(surface)) {
  console.error(`runtime-print: unknown surface "${surface}". Valid: api`)
  process.exit(1)
}

const envTargets = JSON.parse(readFileSync(join(ROOT, 'config', 'environment-targets.json'), 'utf-8'))
const requirements = JSON.parse(readFileSync(join(ROOT, 'config', 'runtime-requirements.json'), 'utf-8'))

const target = envTargets[stage]
const reqs = requirements[surface].filter((r) => r.requiredIn.includes(stage))
const secrets = reqs.filter((r) => r.delivery === 'secret').map((r) => r.name)
const variables = reqs.filter((r) => r.delivery === 'variable').map((r) => r.name)

console.log(`\n=== OpenPencil Runtime Config ===`)
console.log(`Stage:    ${stage}`)
console.log(`Surface:  ${surface}`)
console.log(`\n--- Environment Target ---`)
for (const [k, v] of Object.entries(target)) console.log(`  ${k}: ${v}`)
console.log(`\n--- Runtime Requirements (${reqs.length} total) ---`)
console.log(`  Secrets (${secrets.length}): ${secrets.join(', ') || '(none)'}`)
console.log(`  Variables (${variables.length}): ${variables.join(', ') || '(none)'}`)
console.log('')
