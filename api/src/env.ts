export interface Env {
  DB: D1Database
  DOCUMENTS: R2Bucket
  ASSETS: R2Bucket
  DOCUMENT_ROOM: DurableObjectNamespace
  PUBLIC_APP_URL?: string
  PUBLIC_SITE_URL?: string
  BETTER_AUTH_URL?: string
  BETTER_AUTH_SECRET?: string
  SENTRY_DSN?: string
  VERSION_METADATA?: { version?: string; deployedAt?: string }
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  SCENARIO_API_KEY?: string
  RESEND_API_KEY?: string
}
