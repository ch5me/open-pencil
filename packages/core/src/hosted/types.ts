/**
 * Hosted environment and feature flag types.
 *
 * Framework-agnostic — consumable by the app, CLI, MCP, and Worker tests.
 * This package defines the type contract; flag resolution is app-specific
 * (Vite env vars for the browser, process.env for Node/Worker).
 *
 * @module hosted-types
 */

/** Runtime environment labels. Must match .ch5/environments.yaml ids. */
export type HostedEnv = 'local' | 'preview' | 'staging' | 'production'

/** Individual hosted capabilities, each independently switchable. */
export interface HostedFeatureFlags {
  /** ELF-hosted auth (cookie-first web session). */
  hostedAuth: boolean
  /** Hosted document storage (D1 + R2 via Worker API). */
  hostedDocs: boolean
  /** Hosted real-time collaboration (Durable Object rooms). */
  hostedCollab: boolean
}

/** Full environment contract: feature flags plus topology URLs. */
export interface HostedEnvironmentConfig {
  env: HostedEnv
  flags: HostedFeatureFlags
  /** Base URL for the OpenPencil API Worker. Empty string in local-only mode. */
  apiOrigin: string
  /** OAuth callback URL for ELF auth. Empty string when hostedAuth is off. */
  authCallbackUrl: string
  /** Public app URL for this environment. */
  appUrl: string
}

/** Operating mode labels as defined in hosted-operating-modes.md. */
export type OperatingMode =
  | 'local-only'
  | 'hosted-auth-local-docs'
  | 'hosted-docs-single-user'
  | 'hosted-collab'

/**
 * Derive the operating mode from a feature flag set.
 * Mirrors the getOperatingMode() implementation in the app flags module.
 */
export function deriveOperatingMode(flags: HostedFeatureFlags): OperatingMode {
  if (flags.hostedCollab) return 'hosted-collab'
  if (flags.hostedDocs) return 'hosted-docs-single-user'
  if (flags.hostedAuth) return 'hosted-auth-local-docs'
  return 'local-only'
}

/**
 * Validate that a HostedEnvironmentConfig is internally consistent.
 * Returns an array of violation strings; empty array means valid.
 */
export function validateHostedConfig(config: HostedEnvironmentConfig): string[] {
  const violations: string[] = []

  // apiOrigin must be set when any hosted feature is on
  const anyHosted = config.flags.hostedAuth || config.flags.hostedDocs || config.flags.hostedCollab
  if (anyHosted && !config.apiOrigin) {
    violations.push('apiOrigin is required when any hosted feature is enabled')
  }

  // authCallbackUrl must be set when hostedAuth is on
  if (config.flags.hostedAuth && !config.authCallbackUrl) {
    violations.push('authCallbackUrl is required when hostedAuth is enabled')
  }

  // hostedCollab requires both hostedAuth and hostedDocs
  if (config.flags.hostedCollab && !config.flags.hostedAuth) {
    violations.push('hostedCollab requires hostedAuth to be enabled')
  }
  if (config.flags.hostedCollab && !config.flags.hostedDocs) {
    violations.push('hostedCollab requires hostedDocs to be enabled')
  }

  // hostedDocs requires hostedAuth
  if (config.flags.hostedDocs && !config.flags.hostedAuth) {
    violations.push('hostedDocs requires hostedAuth to be enabled')
  }

  return violations
}
