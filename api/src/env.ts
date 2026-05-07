export interface Env {
  DB: D1Database
  DOCUMENTS: R2Bucket
  ASSETS: R2Bucket
  DOCUMENT_ROOM: DurableObjectNamespace
  NODE_ENV?: 'development' | 'staging' | 'production'
  PUBLIC_APP_URL?: string
  PUBLIC_SITE_URL?: string
  BETTER_AUTH_URL?: string
  BETTER_AUTH_SECRET?: string
  SENTRY_DSN?: string
  VERSION_METADATA?: { version?: string; deployedAt?: string }
  OPENROUTER_API_KEY?: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  SCENARIO_API_KEY?: string
  SCENARIO_API_SECRET?: string
  SCENARIO_SECRET_API_KEY?: string
  RESEND_API_KEY?: string
  USER_KEY_ENCRYPTION_SECRET?: string
}
