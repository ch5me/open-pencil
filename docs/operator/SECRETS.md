# OpenPencil Secrets Management

Secrets are managed via Hush v3. The target mapping is in `config/hush-env-matrix.json`.

## Required Secrets

See `config/runtime-requirements.json` for the full list. Summary:

| Secret | Surface | Stages | Purpose |
|--------|---------|--------|---------|
| BETTER_AUTH_SECRET | api | all | Better Auth signing secret |
| OPENAI_API_KEY | api | all | Hosted AI chat proxy |
| ANTHROPIC_API_KEY | api | all | Hosted AI chat proxy |
| SCENARIO_API_KEY | api | all | Hosted image generation proxy |
| RESEND_API_KEY | api | staging, production | Magic link email delivery |
| SENTRY_DSN | api | staging, production | Worker error monitoring |

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
