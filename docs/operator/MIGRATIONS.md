# OpenPencil D1 Migration Guide

## Schema Source of Truth

`api/src/db/schema.ts` is the source of truth. Never edit migrations manually.

## Generate Migrations

After schema changes:
```sh
cd api && npx drizzle-kit generate
```

Commit generated migrations alongside schema changes.

## Apply Migrations

### Local (wrangler dev)
```sh
npx wrangler d1 migrations apply openpencil-db --local
```

### Staging
```sh
npx wrangler d1 migrations apply openpencil-db-staging --env staging --remote
```

### Production
```sh
npx wrangler d1 migrations apply openpencil-db --remote
```

Production uses the top-level Worker config in `api/wrangler.toml`, not an `env.production` block.

Only run the production command after staging proof and explicit approval.

## Migration Failure Recovery

If a migration fails mid-apply:
1. Check partial state: `npx wrangler d1 execute openpencil-db --command "SELECT * FROM d1_migrations"`
2. Fix the migration file and re-apply
3. Never run production migrations without testing on staging first

## Rollback Schema

D1 does not support schema rollback. To undo a migration:
1. Write a new migration that reverses the changes
2. Apply the reversal migration
