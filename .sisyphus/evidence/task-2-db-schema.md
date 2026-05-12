# Task 2 Evidence: D1 Database Schema

## Completed: 2025-05-04

## Files Created/Modified

### `api/src/db/schema.ts`
- Better Auth tables: `users`, `sessions`, `accounts`, `verification` (all text PKs, integer timestamps)
- OpenPencil domain tables: `documents`, `document_members`, `document_snapshots`, `share_links`, `local_doc_imports`
- All IDs are `text()` primary keys
- Integer timestamps (Unix epoch seconds) for all timestamp fields
- Index on `ownerId` for documents
- Index on `(documentId, userId)` for document_members
- Index on `documentId` for document_snapshots
- Index on `token` for share_links (unique)
- `localDocImports.localDocId` as sole PK

### `api/src/db/index.ts`
- Exports `createDb()` factory returning Drizzle instance with schema
- Re-exports schema

### `api/src/db/migrate.ts`
- `runMigrations()` function using `drizzle-orm/migrator`
- Graceful error handling with re-throw

### `api/src/env.ts`
- Full `Env` interface with DB, R2 buckets, Durable Object, and all secrets

### `api/drizzle.config.ts`
- Configured with `driver: 'd1'` and `dbCredentials: { binding: 'DB' }`

### `api/src/index.ts`
- Minimal Hono app skeleton with CORS middleware
- Health check + placeholder document routes

### `api/package.json`
- Updated with all required deps (hono, drizzle-orm, better-auth)
- `dev`, `build`, `typecheck` scripts

### `api/tsconfig.json`
- Standalone tsconfig with ES2022, bundler resolution, workers-types

### `scripts/db-generate.sh` + `scripts/db-migrate-local.sh`
- Migration scripts added

### `tests/api/db-schema.spec.ts`
- Vitest tests for role validation, token uniqueness, primary keys

### Root `package.json` + `pnpm-workspace.yaml`
- Added `api` to workspaces and root scripts