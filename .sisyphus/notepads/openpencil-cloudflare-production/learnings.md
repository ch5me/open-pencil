# OpenPencil Cloudflare Production — Learnings

## 2026-05-04 — Initial operator scaffold created

### What was built

Created the full CH5 operator scaffold for OpenPencil's hosted Cloudflare Workers deployment:

```
config/
  environment-targets.json   — local/staging/production targets (d1DatabaseId placeholders)
  runtime-requirements.json  — api surface: JWT_SECRET, BETTER_AUTH_SECRET, OPENAI_API_KEY, etc.
  hush-env-matrix.json       — hush target mapping for api-dev/api-staging/api-production

packages/runtime-config/src/index.ts  — typed adapter (derive from FitBot pattern)

api/wrangler.toml           — workers_dev=false, custom domains, D1+R2+DO bindings
devmux.config.json          — api (8787) + web (1420) services

scripts/
  deploy-validate.mjs       — config consistency checker
  secrets-validate.mjs      — Hush target coverage checker
  runtime-print.mjs         — print staged targets
  release-candidate.mjs      — write manifest to .sisyphus/candidates/
  promote-production.mjs    — promote from recorded candidate (stub)
  rollback-production.mjs   — rollback from recorded candidate (stub)

.github/workflows/
  deploy-staging.yml        — push-to-main auto-deploy
  promote-production.yml    — promote from candidate (workflow_dispatch)
  rollback-production.yml   — rollback from candidate (workflow_dispatch)
```

### Key design decisions

- **workerName pattern**: `openpencil-api-dev`, `openpencil-api-staging`, `openpencil-api` (production)
- **Custom domains**: `api.openpencil.dev` (prod), `api.staging.openpencil.dev` (staging)
- **R2 buckets**: `IMAGES` (document blobs) and `PREVIEWS` (thumbnails) — separate from FitBot's single images bucket
- **Durable Objects**: `RealtimeRelayDO` placeholder registered even though not yet implemented — required for wrangler migration tagging
- **D1 database ids**: Placeholder strings (`YOUR_PRODUCTION_D1_DATABASE_ID`) since real UUIDs not yet provisioned
- **API surface**: Only `api` — no `landing` or `app` surfaces since OpenPencil is a desktop/browser editor
- **No mobile identity fields** — unlike FitBot, OpenPencil doesn't have iosAppName/androidPackage

### TODO before production

1. Provision real D1 database IDs via `wrangler d1 create openpencil-db`
2. Register `api.openpencil.dev` and `api.staging.openpencil.dev` as Cloudflare Workers routes
3. Implement actual `promote-production.mjs` using Cloudflare API or Deploy Depot
4. Implement actual `rollback-production.mjs`
5. Add `.sisyphus/candidates/` to gitignore or commit as LFS
6. Set up Hush secrets for `api-production` bundle with all required secrets
7. Verify `@ch5me/origin-policy` is available as a dependency

### Reference sources

- FitBot `config/environment-targets.json` — structure pattern
- FitBot `packages/runtime-config/src/index.ts` — typed adapter pattern
- FitBot `api/wrangler.toml` — Cloudflare Worker config pattern
- FitBot `.github/workflows/deploy-staging.yml` — CI pattern

### Runtime config usage

```typescript
import {
  OPENPENCIL_STAGES,
  OPENPENCIL_RUNTIME_SURFACES,
  getOpenPencilEnvironmentTarget,
  getOpenPencilRuntimeRequirements,
  getOpenPencilRuntimeSecretNames,
  validateOpenPencilRuntimeConfig,
  assertOpenPencilRuntimeConfig,
  createOpenPencilOriginValidator,
  getOpenPencilStageFromUrl,
} from '@open-pencil/runtime-config'
```

## 2026-05-04 — F1 plan compliance audit rejected current implementation

F1 reviewed the current Cloudflare production implementation and returned REJECT. Critical repair themes before any final wave retry:

- D1 Drizzle schema/migrations and Worker SQL disagree (`sessions`/`accounts` camelCase vs service queries for `session`/`account` and snake_case columns).
- Several app-side hosted files were created under `app/src`, but OpenPencil's real app is root `src`; hosted auth/persistence/AI/observability must be wired into the real app, not an unused tree.
- Auth routes are likely shadowed by `app.all('/api/auth/*')` before custom auth endpoints, and root `src/composables/useSession.ts` stores bearer tokens in localStorage.
- Durable Object websocket routing does not actually forward `/api/collab/.../ws` upgrades to the DO; DO flush emits JSON masquerading as `.fig` rather than real Kiwi snapshots.
- Production promote/rollback scripts explicitly say they are stubs.
- `Math.random()` and `as any` remain in hosted/realtime/logger code and violate project rules.

Next implementation work should fix these cross-layer blockers before marking Tasks 6/8/9/10 or any final verification gate complete.


## 2026-05-04 — Boulder continuation blocker

Boulder continuation was invoked after F1 REJECT. The active session is Atlas/orchestrator-only but the available tool surface does not include `task()`. Atlas rules prohibit direct implementation edits; remaining implementation tasks (6, 8, 9, 10) require code-writing specialists. I corrected duplicated completed top-level checkboxes for Tasks 4, 5, and 7 in the plan, but did not mark any rejected final-wave gate complete.

Remaining executable work requires a session/tooling context with `task()` delegation or a non-Atlas implementation agent.


## 2026-05-04 — Repeated Boulder continuation: still blocked by missing delegation tool

Plan was re-read as required. Last completed implementation tasks are already checked. Remaining top-level implementation tasks are still 6, 8, 9, and 10, followed by F1-F4. No final-wave task can be checked because F1 previously returned REJECT.

This Atlas session still has no `task()` tool in its available tool namespace. Per Atlas boundary rules, implementation code/test/docs changes must be delegated, not written directly here. Therefore no remaining implementation task can be honestly completed in this session. Blocker remains: continue from an implementation-capable session or enable `task()` delegation.


## 2026-05-04 — Boulder continuation no-op confirmation

Plan re-read again. Completed checkboxes remain correct. Remaining unchecked top-level items are Tasks 6, 8, 9, 10 and F1-F4. No additional checkbox should be marked because no implementation or passing final verification happened.

Blocker unchanged: current Atlas session has no `task()` delegation capability, while Atlas rules prohibit direct code/test/docs implementation. Continuing requires an implementation-capable agent/session.


## 2026-05-04 — Boulder continuation still cannot execute remaining tasks

Plan re-read per directive. Last completed task checkbox state is already correct. Unchecked top-level work remains Tasks 6, 8, 9, 10 plus F1-F4. F1 previously rejected, so final verification boxes must remain unchecked.

The session remains blocked because Atlas has no available `task()` tool and must not directly implement code. No further progress can be made in this orchestrator-only tool surface without enabling delegation or switching to an implementation agent.


## 2026-05-04 — Repeated Boulder continuation: no implementation authority

Plan re-read. Checked state unchanged and correct: completed Tasks 1-5 and 7 are checked; Tasks 6, 8, 9, 10 and F1-F4 remain unchecked. F1 remains rejected, so final verification gates cannot be marked.

Blocker unchanged: this Atlas session lacks `task()` and cannot directly write implementation code under Atlas boundaries. Need `task()` delegation or an implementation-mode agent to proceed.


## 2026-05-04 — Continuation loop status

Plan re-read. No completed unchecked item exists. Remaining unchecked work is implementation Tasks 6, 8, 9, 10 and final gates F1-F4. This is still blocked in Atlas because `task()` is unavailable and direct implementation is disallowed by the active orchestrator instructions.


## 2026-05-04 — Boulder continuation blocked (no task tool)

Plan re-read as first action. No completed unchecked task is present. Remaining unchecked work is Tasks 6, 8, 9, 10 and F1-F4. This session still cannot execute remaining implementation because Atlas has no `task()` delegation tool and direct implementation is forbidden by active Atlas instructions.

## 2026-05-05 live deployment learnings
- Actual CH5 surfaces are `pencil.ch5.me`, `staging.pencil.ch5.me`, `api.pencil.ch5.me`, and `api.staging.pencil.ch5.me` — not `openpencil.dev`.
- Existing Pages projects are `openpencil` (prod) and `openpencil-staging` (staging).
- Existing Workers are `openpencil-api` (prod) and `openpencil-api-staging` (staging).
- `wrangler deploy` can upload new Worker code successfully while failing route mutation with auth error 10000; use `wrangler versions upload` + `wrangler versions deploy <version>@100` to activate code without changing routes.
- Live D1 databases required in-place upgrades because they already had older auth/document tables; fresh init SQL was not sufficient.
- Better Auth sign-up required `accounts.password` and a non-null-safe `providerType`; both had to be aligned in live schema and code.
- Cookie-first hosted auth works live after wiring `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` into the Better Auth factory and using Better Auth session lookup inside document routes.
- Inline auth UX was missing in the editor despite `/login` and `/signup` views existing; the visible fix was to replace the dead collab user badge with a real `CollabAuthPopover` in the share/collab bar.
- Hosted sharing was wired but not end-to-end: the API token lookup route was mistakenly protected by auth middleware and the share-token generator produced all-zero tokens before crypto.getRandomValues() was added.
- Browser-side hosted API consumers must derive `API_BASE_URL` from the live hostname (`pencil.ch5.me` vs `staging.pencil.ch5.me`) when no Vite env override is present; relative `/api/*` calls hit Pages, not the Worker.
- Managed AI needed two layers of fixes: cookie-first auth acceptance on Worker AI routes plus provider-compatible endpoints (`/api/ai/messages`, `/api/ai/chat/completions`) so the browser SDK can talk to the Worker as a model backend.
- The Better Auth browser session cookie name is `__Secure-better-auth.session_token`, not `openpencil_session`.
- OpenPencil managed AI now works live through OpenAI on both staging and production after setting Worker secrets `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`; Anthropic account was credit-blocked, so the product default was moved to OpenAI-backed managed mode.
