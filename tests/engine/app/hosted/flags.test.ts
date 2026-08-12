import { describe, expect, test } from 'bun:test'

import {
  deriveOperatingMode,
  validateHostedConfig,
  type HostedEnvironmentConfig,
  type HostedFeatureFlags
} from '@open-pencil/core/hosted'

const localFlags: HostedFeatureFlags = {
  hostedAuth: false,
  hostedAgent: false,
  hostedDocs: false,
  hostedCollab: false
}

function configWith(flags: HostedFeatureFlags): HostedEnvironmentConfig {
  return {
    env: 'local',
    flags,
    apiOrigin: flags.hostedAuth || flags.hostedAgent ? 'http://127.0.0.1:8787' : '',
    authOrigin: flags.hostedAuth ? 'http://127.0.0.1:8788' : '',
    authCallbackUrl: flags.hostedAuth ? 'http://127.0.0.1:8787/api/auth/callback' : '',
    appUrl: 'http://localhost:1420'
  }
}

describe('hosted agent capability', () => {
  test('accepts agent chat independently of docs and collaboration when auth is enabled', () => {
    const config = configWith({ ...localFlags, hostedAuth: true, hostedAgent: true })

    expect(validateHostedConfig(config)).toEqual([])
    expect(deriveOperatingMode(config.flags)).toBe('hosted-auth-local-docs')
  })

  test('returns the specific violation when agent chat is enabled without auth', () => {
    const config = configWith({ ...localFlags, hostedAgent: true })

    expect(validateHostedConfig(config)).toContain('hostedAgent requires hostedAuth to be enabled')
  })
})
