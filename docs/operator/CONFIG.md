# OpenPencil Configuration Reference

## environment-targets.json

`config/environment-targets.json` is the source of truth for per-stage infrastructure targets.

| Field | Purpose |
|-------|---------|
| stage | local / staging / production |
| apiBaseUrl | Worker API base URL |
| appUrl | Web app URL |
| siteUrl | Landing/marketing site URL |
| workerName | Cloudflare Worker name |
| workerEnv | Wrangler env name (empty for production) |
| d1DatabaseName | D1 database name |
| d1DatabaseId | D1 database UUID (set real IDs after provisioning) |
| r2Bucket | R2 bucket for document blobs |
| r2AssetsBucket | R2 bucket for thumbnails/previews |

## runtime-requirements.json

`config/runtime-requirements.json` declares every secret and variable the Worker needs.

Used by `scripts/deploy-validate.mjs` and `scripts/secrets-validate.mjs` to gate deployments.

## wrangler.toml

`api/wrangler.toml` is the Cloudflare Worker configuration.

- Base config = production
- `[env.staging]` = staging overrides
- D1 binding: `DB`
- R2 bindings: `DOCUMENTS` (doc blobs), `ASSETS` (thumbnails)
- DO binding: `DOCUMENT_ROOM` → `DocumentRoomDO`

## devmux.config.json

Local dev services:
- `api`: runs `npx wrangler dev` on port 8787 with health check at `/health`
- `web`: runs Vite on port 5173, depends on `api`

Start all local services: `devmux ensure api web`

## Proof Lanes

Run from repo root:
- `pnpm proof:unit` — bun unit tests
- `pnpm proof:api` — Vitest API tests
- `pnpm proof:hosted` — Playwright hosted E2E
- `pnpm proof:all` — all lanes sequentially
