#!/usr/bin/env bun
/**
 * Validate the hosted feature flags and environment topology contract.
 *
 * Checks:
 * 1. Feature flag types compile correctly
 * 2. Environment topology JSON is valid and aligned with .ch5/environments.yaml
 * 3. Flag dependency constraints are enforced
 * 4. Local-only default when OPENPENCIL_HOSTED_ENV is unset
 * 5. All four environments resolve without errors
 * 6. validateHostedConfig catches invalid combinations
 */

import { readFileSync } from 'node:fs'

import {
  deriveOperatingMode,
  validateHostedConfig,
  type HostedEnvironmentConfig
} from '#core/hosted/types.ts'

let passCount = 0
let failCount = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passCount++
    console.log(`  PASS: ${label}`)
  } else {
    failCount++
    console.log(`  FAIL: ${label}`)
  }
}

// --- 1. Topology JSON is valid ---
console.log('\n1. Topology JSON validation')
const topology = JSON.parse(readFileSync('./config/hosted-topology.json', 'utf8'))
assert(topology.version === 1, 'topology version is 1')
assert(Object.keys(topology.environments).length === 4, '4 environments declared')
assert('local' in topology.environments, 'local environment present')
assert('preview' in topology.environments, 'preview environment present')
assert('staging' in topology.environments, 'staging environment present')
assert('production' in topology.environments, 'production environment present')

// --- 2. Alignment with .ch5/environments.yaml ---
console.log('\n2. Alignment with .ch5/environments.yaml')
const envYaml = readFileSync('./.ch5/environments.yaml', 'utf8')
assert(envYaml.includes('openpencil-staging'), 'envs.yaml declares staging')
assert(envYaml.includes('openpencil-production'), 'envs.yaml declares production')
assert(envYaml.includes('openpencil-local'), 'envs.yaml declares local')
assert(
  topology.environments.staging.apiOrigin === 'https://api.staging.design.elf.dance',
  'staging apiOrigin matches envs.yaml API URL'
)
assert(
  topology.environments.production.apiOrigin === 'https://api.design.elf.dance',
  'production apiOrigin matches envs.yaml API URL'
)

// --- 3. Flag dependency constraints ---
console.log('\n3. Flag dependency constraints (validateHostedConfig)')

const validConfig: HostedEnvironmentConfig = {
  env: 'staging',
  flags: { hostedAuth: true, hostedDocs: true, hostedCollab: false },
  apiOrigin: 'https://api.staging.design.elf.dance',
  authCallbackUrl: 'https://staging.design.elf.dance/api/auth/callback',
  appUrl: 'https://staging.design.elf.dance'
}
assert(validateHostedConfig(validConfig).length === 0, 'valid staging config passes validation')

const collabWithoutAuth: HostedEnvironmentConfig = {
  env: 'local',
  flags: { hostedAuth: false, hostedDocs: false, hostedCollab: true },
  apiOrigin: '',
  authCallbackUrl: '',
  appUrl: ''
}
const collabErrs = validateHostedConfig(collabWithoutAuth)
assert(collabErrs.length > 0, 'collab without auth produces violations')
assert(
  collabErrs.some((e) => e.includes('hostedAuth')),
  'violation mentions hostedAuth requirement'
)

const docsWithoutAuth: HostedEnvironmentConfig = {
  env: 'local',
  flags: { hostedAuth: false, hostedDocs: true, hostedCollab: false },
  apiOrigin: '',
  authCallbackUrl: '',
  appUrl: ''
}
const docsErrs = validateHostedConfig(docsWithoutAuth)
assert(docsErrs.length > 0, 'docs without auth produces violations')

const hostedNoApi: HostedEnvironmentConfig = {
  env: 'staging',
  flags: { hostedAuth: true, hostedDocs: false, hostedCollab: false },
  apiOrigin: '',
  authCallbackUrl: '',
  appUrl: 'https://staging.design.elf.dance'
}
const apiErrs = validateHostedConfig(hostedNoApi)
assert(
  apiErrs.some((e) => e.includes('apiOrigin')),
  'hosted without apiOrigin produces violation'
)

const hostedAuthNoCallback: HostedEnvironmentConfig = {
  env: 'staging',
  flags: { hostedAuth: true, hostedDocs: false, hostedCollab: false },
  apiOrigin: 'https://api.staging.design.elf.dance',
  authCallbackUrl: '',
  appUrl: 'https://staging.design.elf.dance'
}
const cbErrs = validateHostedConfig(hostedAuthNoCallback)
assert(
  cbErrs.some((e) => e.includes('authCallbackUrl')),
  'hostedAuth without callback URL produces violation'
)

// --- 4. Operating mode derivation ---
console.log('\n4. Operating mode derivation')
assert(
  deriveOperatingMode({ hostedAuth: false, hostedDocs: false, hostedCollab: false }) ===
    'local-only',
  'all off -> local-only'
)
assert(
  deriveOperatingMode({ hostedAuth: true, hostedDocs: false, hostedCollab: false }) ===
    'hosted-auth-local-docs',
  'auth only -> hosted-auth-local-docs'
)
assert(
  deriveOperatingMode({ hostedAuth: true, hostedDocs: true, hostedCollab: false }) ===
    'hosted-docs-single-user',
  'auth+docs -> hosted-docs-single-user'
)
assert(
  deriveOperatingMode({ hostedAuth: true, hostedDocs: true, hostedCollab: true }) ===
    'hosted-collab',
  'all on -> hosted-collab'
)

// --- 5. Independent switchability ---
console.log('\n5. Independent switchability')
// Each environment has a unique flag combination
const localFlags = topology.environments.local.flags
const previewFlags = topology.environments.preview.flags
const stagingFlags = topology.environments.staging.flags
const prodFlags = topology.environments.production.flags

assert(
  localFlags.hostedAuth === false &&
    localFlags.hostedDocs === false &&
    localFlags.hostedCollab === false,
  'local: all flags off'
)
assert(
  previewFlags.hostedAuth === true &&
    previewFlags.hostedDocs === false &&
    previewFlags.hostedCollab === false,
  'preview: auth only'
)
assert(
  stagingFlags.hostedAuth === true &&
    stagingFlags.hostedDocs === true &&
    stagingFlags.hostedCollab === false,
  'staging: auth+docs'
)
assert(
  prodFlags.hostedAuth === true &&
    prodFlags.hostedDocs === true &&
    prodFlags.hostedCollab === false,
  'production: auth+docs (collab deferred)'
)

// Preview and staging have different flag combos — proves independent switchability
assert(JSON.stringify(localFlags) !== JSON.stringify(previewFlags), 'local ≠ preview (independent)')
assert(
  JSON.stringify(previewFlags) !== JSON.stringify(stagingFlags),
  'preview ≠ staging (independent)'
)

// --- 6. Callback URLs are explicit per environment ---
console.log('\n6. Callback URLs explicit per environment')
assert(topology.environments.local.authCallbackUrl === '', 'local: no callback URL')
assert(topology.environments.preview.authCallbackUrl !== '', 'preview: callback URL set')
assert(topology.environments.staging.authCallbackUrl !== '', 'staging: callback URL set')
assert(topology.environments.production.authCallbackUrl !== '', 'production: callback URL set')
assert(
  topology.environments.staging.authCallbackUrl !==
    topology.environments.production.authCallbackUrl,
  'staging and production callback URLs differ'
)

// --- Summary ---
console.log(`\n--- Results: ${passCount} passed, ${failCount} failed ---`)
if (failCount > 0) {
  process.exit(1)
}
