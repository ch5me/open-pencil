#!/usr/bin/env bun
import '../tools/hosted/src/validate-flags'

import { readFileSync } from 'node:fs'

import { validateHostedConfig, type HostedEnvironmentConfig } from '@open-pencil/core/hosted'

const topology = JSON.parse(readFileSync('./config/hosted-topology.json', 'utf8')) as {
  environments: Record<string, HostedEnvironmentConfig>
  envVarContract: Record<string, unknown>
}

const missingAgentDefaults = Object.entries(topology.environments)
  .filter(([, config]) => config.flags.hostedAgent !== false)
  .map(([environment]) => environment)

if (missingAgentDefaults.length > 0) {
  throw new Error(
    `hostedAgent must default to false in every environment: ${missingAgentDefaults.join(', ')}`
  )
}

if (!('VITE_HOSTED_AGENT_ENABLED' in topology.envVarContract)) {
  throw new Error('VITE_HOSTED_AGENT_ENABLED is missing from the hosted env var contract')
}

const invalidAgentConfig: HostedEnvironmentConfig = {
  env: 'local',
  flags: {
    hostedAuth: false,
    hostedAgent: true,
    hostedDocs: false,
    hostedCollab: false
  },
  apiOrigin: 'http://127.0.0.1:8787',
  authOrigin: '',
  authCallbackUrl: '',
  appUrl: 'http://localhost:1420'
}
const expectedViolation = 'hostedAgent requires hostedAuth to be enabled'
if (!validateHostedConfig(invalidAgentConfig).includes(expectedViolation)) {
  throw new Error(`Missing config violation: ${expectedViolation}`)
}
