# OpenPencil Secrets Management

Secrets are managed via Hush v3. The target mapping is in `config/hush-env-matrix.json`.

## Required Secrets

See `config/runtime-requirements.json` for the full list. Summary:

| Secret | Surface | Stages | Purpose |
|--------|---------|--------|---------|
| BETTER_AUTH_SECRET | api | all | Better Auth signing secret |
| OPENROUTER_API_KEY | api | all | Managed hosted chat key for `@ch5.me` accounts |
| OPENAI_API_KEY | api | all | Hosted AI chat proxy |
| ANTHROPIC_API_KEY | api | all | Hosted AI chat proxy |
| SCENARIO_API_KEY | api | all | Hosted image generation proxy key, or combined `key:secret` pair |
| SCENARIO_API_SECRET | api | all | Hosted image generation proxy secret when stored separately |
| RESEND_API_KEY | api | staging, production | Magic link email delivery |
| SENTRY_DSN | api | staging, production | Worker error monitoring |
| USER_KEY_ENCRYPTION_SECRET | api | all | Encrypts per-user saved provider keys before D1 storage |

## Validate Coverage

```sh
node scripts/secrets-validate.mjs
```

## Add a New Secret

1. Add to `config/runtime-requirements.json` under the `api` array
2. Add to `api/src/env.ts` Env interface
3. Run `hush set <target> <KEY> <value>` for each stage
4. Run `node scripts/secrets-validate.mjs` to verify

## Worker Secret Deployment

Secrets are injected as Worker secrets (not vars) via:
```sh
npx wrangler secret put BETTER_AUTH_SECRET --env staging
npx wrangler secret put BETTER_AUTH_SECRET --env production
```
