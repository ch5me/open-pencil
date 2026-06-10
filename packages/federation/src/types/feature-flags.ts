/**
 * Public feature-flag contract. Sub-apps that want to know which federation
 * capabilities are enabled in a given environment read this. The shape is
 * stable: a flag may be added in a MINOR version, but never renamed or
 * removed in a MAJOR.
 *
 * @module types/feature-flags
 */

export type HostedEnv = 'local' | 'preview' | 'staging' | 'production'

/** Individual hosted capabilities, each independently switchable. */
export type HostedFeatureFlags = {
  /** ELF-hosted auth (cookie-first web session). */
  hostedAuth: boolean
  /** Hosted document storage (D1 + R2 via Worker API). */
  hostedDocs: boolean
  /** Hosted real-time collaboration (Durable Object rooms). */
  hostedCollab: boolean
}

/** Full environment contract: feature flags plus topology URLs. */
export type HostedEnvironmentConfig = {
  env: HostedEnv
  flags: HostedFeatureFlags
  /** Base URL for the API Worker. Empty string in local-only mode. */
  apiOrigin: string
  /** OAuth callback URL for ELF auth. Empty string when hostedAuth is off. */
  authCallbackUrl: string
  /** Public app URL for this environment. */
  appUrl: string
}

/** Operating mode label derived from flag combinations. */
export type OperatingMode =
  | 'local-only'
  | 'hosted-auth-local-docs'
  | 'hosted-docs-single-user'
  | 'hosted-collab'
