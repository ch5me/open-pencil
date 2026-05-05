# OpenPencil Deployment Guide

## Staging

Staging deploys automatically from `main` via `.github/workflows/deploy-staging.yml`.

Manual trigger:
```sh
node scripts/release-candidate.mjs --stage staging
npx wrangler deploy --env staging --config api/wrangler.toml
```

## Production Promotion

Production is promoted from a recorded staging candidate — never rebuilt from source.

```sh
node scripts/release-candidate.mjs --stage staging
# Note the candidate ID from output, e.g. op-staging-1234567890-abcd1234

node scripts/promote-production.mjs --candidate op-staging-1234567890-abcd1234 --dry-run
node scripts/promote-production.mjs --candidate op-staging-1234567890-abcd1234
```

## Rollback

```sh
# List available candidates
ls .sisyphus/candidates/

# Rollback to a known-good candidate
node scripts/rollback-production.mjs --candidate op-staging-PREVIOUS_ID --dry-run
node scripts/rollback-production.mjs --candidate op-staging-PREVIOUS_ID
```

## D1 Migrations

See MIGRATIONS.md for the full migration workflow.

## Recovery Procedures

### Worker 500 after deploy
1. Check `wrangler tail --env production` for errors
2. Check D1 schema is up to date: `npx wrangler d1 execute openpencil-db --command "SELECT * FROM users LIMIT 1"`
3. If schema lag: run `npx wrangler d1 migrations apply openpencil-db --env production`
4. If persistent: rollback to last known-good candidate (see above)

### R2 blob missing
1. Confirm key in D1: `SELECT latest_snapshot_key FROM documents WHERE id = '<docId>'`
2. Verify R2 key exists: `npx wrangler r2 object get openpencil-documents <key>`
3. If missing: restore from snapshot history (`document_snapshots` table has previous keys)

### Durable Object crash
1. Check `wrangler tail` for DO errors
2. DOs are automatically restarted by Cloudflare — state is persisted in DO storage
3. If state lost: the R2 snapshot is the recovery point (load from `documents.latestSnapshotKey`)
