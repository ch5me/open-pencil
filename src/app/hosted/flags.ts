/**
 * Hosted feature flags — independently toggleable gates for auth, agent chat, docs, and
 * collaboration.
 *
 * Flags resolve from Vite env vars with explicit per-environment defaults.
 * No implicit environment guessing: every mode is explicitly declared.
 *
 * Reading a flag when OPENPENCIL_HOSTED_ENV is unset returns the local-only baseline
 * (all hosted features off) so local-first behavior is never broken.
 *
 * @module hosted-flags
 */

import type {
  HostedEnv,
  HostedEnvironmentConfig,
  HostedFeatureFlags
} from '@open-pencil/core/hosted'

export type {
  HostedEnv,
  HostedEnvironmentConfig,
  HostedFeatureFlags
} from '@open-pencil/core/hosted'

// ---------------------------------------------------------------------------
// Default per-environment topology
//
// These values are the canonical defaults. They can be overridden at runtime
// via Vite env vars (see resolveHostedConfig).
// ---------------------------------------------------------------------------

const ENV_DEFAULTS: Record<HostedEnv, Omit<HostedEnvironmentConfig, 'env'>> = {
  local: {
    flags: { hostedAuth: false, hostedAgent: false, hostedDocs: false, hostedCollab: false },
    apiOrigin: '',
    authOrigin: '',
    authCallbackUrl: '',
    appUrl: 'http://localhost:1420'
  },
  preview: {
    flags: { hostedAuth: true, hostedAgent: false, hostedDocs: false, hostedCollab: false },
    apiOrigin: 'https://staging-openpencil-api.elf.dance',
    authOrigin: 'https://staging.app.elf.dance',
    authCallbackUrl: '',
    appUrl: '' // resolved at deploy time by Pages
  },
  staging: {
    flags: { hostedAuth: true, hostedAgent: false, hostedDocs: true, hostedCollab: false },
    apiOrigin: 'https://staging-openpencil-api.elf.dance',
    authOrigin: 'https://staging.app.elf.dance',
    authCallbackUrl:
      'https://staging-openpencil-api.elf.dance/api/auth/firefly/callback?returnTo=https%3A%2F%2Fstaging.design.elf.dance%2F',
    appUrl: 'https://staging.design.elf.dance'
  },
  production: {
    flags: { hostedAuth: true, hostedAgent: false, hostedDocs: true, hostedCollab: false },
    apiOrigin: 'https://openpencil-api.elf.dance',
    authOrigin: 'https://app.elf.dance',
    authCallbackUrl:
      'https://openpencil-api.elf.dance/api/auth/firefly/callback?returnTo=https%3A%2F%2Fdesign.elf.dance%2F',
    appUrl: 'https://design.elf.dance'
  }
}

// ---------------------------------------------------------------------------
// Env var names (Vite-import.meta.env)
// ---------------------------------------------------------------------------

const ENV_VAR_NAMES = {
  ENV: 'OPENPENCIL_HOSTED_ENV' as const,
  AUTH_ENABLED: 'VITE_HOSTED_AUTH_ENABLED' as const,
  AGENT_ENABLED: 'VITE_HOSTED_AGENT_ENABLED' as const,
  DOCS_ENABLED: 'VITE_HOSTED_DOCS_ENABLED' as const,
  COLLAB_ENABLED: 'VITE_HOSTED_COLLAB_ENABLED' as const,
  API_ORIGIN: 'VITE_API_ORIGIN' as const,
  AUTH_ORIGIN: 'VITE_AUTH_ORIGIN' as const,
  AUTH_CALLBACK: 'VITE_AUTH_CALLBACK_URL' as const,
  APP_URL: 'VITE_APP_URL' as const
} as const

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Read the declared environment from env vars; falls back to 'local'. */
function resolveEnv(): HostedEnv {
  const forced =
    window.openPencil?.test?.forceHostedCollab || window.openPencil?.test?.forceHostedAgent
  if (forced) return 'staging'
  const raw = (import.meta.env[ENV_VAR_NAMES.ENV] as string | undefined) ?? ''
  const normalized = raw.toLowerCase().trim()
  if (normalized === 'preview') return 'preview'
  if (normalized === 'staging') return 'staging'
  if (normalized === 'production') return 'production'
  return 'local'
}

/** Resolve a single boolean flag: env var override > environment default. */
function resolveFlag(env: HostedEnv, flagKey: keyof HostedFeatureFlags, envVar: string): boolean {
  if (window.openPencil?.test?.forceHostedAgent && flagKey === 'hostedAgent') return true
  const forced = window.openPencil?.test?.forceHostedCollab
  if (forced && flagKey !== 'hostedAgent') return true
  const raw = import.meta.env[envVar] as string | undefined
  if (raw !== undefined && raw !== '') {
    return raw === 'true' || raw === '1'
  }
  return ENV_DEFAULTS[env].flags[flagKey]
}

/** Resolve a string config value: env var override > environment default. */
function resolveString(
  env: HostedEnv,
  key: Extract<
    keyof HostedEnvironmentConfig,
    'apiOrigin' | 'authOrigin' | 'authCallbackUrl' | 'appUrl'
  >,
  envVar: string
): string {
  const forced =
    window.openPencil?.test?.forceHostedCollab || window.openPencil?.test?.forceHostedAgent
  if (forced && key === 'apiOrigin') {
    return window.openPencil?.test?.hostedApiOrigin ?? 'http://127.0.0.1:8787'
  }
  if (forced && key === 'authCallbackUrl') {
    const apiOrigin = window.openPencil?.test?.hostedApiOrigin ?? 'http://127.0.0.1:8787'
    const callback = new URL('/api/auth/firefly/callback', apiOrigin)
    callback.searchParams.set('returnTo', 'http://localhost:1420/')
    return callback.toString()
  }
  const raw = import.meta.env[envVar] as string | undefined
  if (raw !== undefined && raw !== '') return raw
  return ENV_DEFAULTS[env][key]
}

/**
 * Resolve the full hosted config for the current runtime.
 *
 * When OPENPENCIL_HOSTED_ENV is unset, resolves to local with all hosted
 * features off — preserving local-only behavior without requiring explicit config.
 */
export function resolveHostedConfig(): HostedEnvironmentConfig {
  const env = resolveEnv()
  return {
    env,
    flags: {
      hostedAuth: resolveFlag(env, 'hostedAuth', ENV_VAR_NAMES.AUTH_ENABLED),
      hostedAgent: resolveFlag(env, 'hostedAgent', ENV_VAR_NAMES.AGENT_ENABLED),
      hostedDocs: resolveFlag(env, 'hostedDocs', ENV_VAR_NAMES.DOCS_ENABLED),
      hostedCollab: resolveFlag(env, 'hostedCollab', ENV_VAR_NAMES.COLLAB_ENABLED)
    },
    apiOrigin: resolveString(env, 'apiOrigin', ENV_VAR_NAMES.API_ORIGIN),
    authOrigin: resolveString(env, 'authOrigin', ENV_VAR_NAMES.AUTH_ORIGIN),
    authCallbackUrl: resolveString(env, 'authCallbackUrl', ENV_VAR_NAMES.AUTH_CALLBACK),
    appUrl: resolveString(env, 'appUrl', ENV_VAR_NAMES.APP_URL)
  }
}

// ---------------------------------------------------------------------------
// Convenience accessors
// ---------------------------------------------------------------------------

let _cached: HostedEnvironmentConfig | undefined

/** Cached hosted config. Safe to call repeatedly; resolves once per module load. */
export function getHostedConfig(): HostedEnvironmentConfig {
  if (
    window.openPencil?.test?.forceHostedCollab ||
    window.openPencil?.test?.forceHostedAgent
  ) {
    return resolveHostedConfig()
  }
  if (!_cached) {
    _cached = resolveHostedConfig()
  }
  return _cached
}

/** True when hosted auth is enabled for this runtime. */
export function isHostedAuthEnabled(): boolean {
  return getHostedConfig().flags.hostedAuth
}

/** True when hosted agent chat is enabled for this runtime. */
export function isHostedAgentEnabled(): boolean {
  return getHostedConfig().flags.hostedAgent
}

/** True when hosted document storage is enabled for this runtime. */
export function isHostedDocsEnabled(): boolean {
  return getHostedConfig().flags.hostedDocs
}

/** True when hosted collaboration is enabled for this runtime. */
export function isHostedCollabEnabled(): boolean {
  return getHostedConfig().flags.hostedCollab
}

/** True when any hosted feature is enabled. */
export function isHostedMode(): boolean {
  const f = getHostedConfig().flags
  return f.hostedAuth || f.hostedAgent || f.hostedDocs || f.hostedCollab
}

/** Operating mode label derived from flag combinations. */
export function getOperatingMode():
  | 'local-only'
  | 'hosted-auth-local-docs'
  | 'hosted-docs-single-user'
  | 'hosted-collab' {
  const f = getHostedConfig().flags
  if (f.hostedCollab) return 'hosted-collab'
  if (f.hostedDocs) return 'hosted-docs-single-user'
  if (f.hostedAuth) return 'hosted-auth-local-docs'
  return 'local-only'
}
