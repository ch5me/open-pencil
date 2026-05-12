# OpenPencil Cloudflare Production

## TL;DR
> **Summary**: Turn OpenPencil into a CH5-standard hosted product by adding a Cloudflare Worker API, Better Auth, D1 metadata/session storage, R2 document storage, and Durable Object-backed collaboration while preserving anonymous local-first usage and existing desktop/file workflows.
> **Deliverables**:
> - Cloudflare operator layer (`environment-targets`, `runtime-requirements`, `runtime-config`, Hush, staging/prod workflows)
> - Better Auth + D1 session and document ownership model
> - R2-backed hosted document save/load/share with anonymous local import
> - IndexedDB offline cache + hosted sync adapter
> - Durable Object collaboration relay/authority for hosted rooms
> - Hosted AI proxy, observability, proof lanes, promotion/rollback docs
> **Effort**: XL
> **Parallel**: YES - 3 waves
> **Critical Path**: 1 → 2 → 3 → 4 → 5 → 6/7 → 8 → 9

## Context
### Original Request
Assess whether OpenPencil is ready for staged/production Cloudflare deployment, then produce the concrete execution plan to make it a hosted Figma-like product aligned with FitBot/CH5 operations: anonymous use allowed, sign-in required for hosted save/sync/share, Better Auth, D1, cloud storage, staging/production CI, and standard Cloudflare operator practices.

### Interview Summary
- Current OpenPencil web deploy is static Cloudflare Pages only (`.github/workflows/app.yml`).
- OpenPencil persistence is local-only today: browser file handles / downloads / Tauri FS plus IndexedDB sticky docs (`src/stores/editor.ts`, `src/stores/sticky-documents.ts`).
- Collaboration is P2P Trystero/WebRTC + Yjs + y-indexeddb with no server authority (`src/composables/use-collab.ts`).
- AI/provider secrets are stored client-side today (`src/composables/use-chat.ts`).
- Slopcade provides reusable Cloudflare backend patterns: Better Auth + D1, R2-backed persistence, Durable Object websocket patterns, Hush/operator layout, staging/prod env split.
- FitBot provides the target CH5 operator model: `environment-targets.json`, `runtime-requirements.json`, `runtime-config` package, Hush env matrix, Better Auth + D1 on Workers, staging auto-deploy from `main`, recorded release candidates, manual production promotion/rollback, devmux hostnames, observability.

### Metis Review (gaps addressed)
- Preserve anonymous/local-first usage as a non-negotiable invariant.
- Require sign-in only for hosted save/sync/share/collab.
- Keep MVP scope bounded: no teams/orgs, billing, comments, template marketplace, or full AI platform rewrite.
- Make hosted document authority explicit: R2 stores canonical `.fig` snapshots; D1 stores metadata/ownership/permissions; Durable Objects hold live Yjs collaboration state and flush back to snapshots.
- Separate hosted product work from local MCP/automation work so Cloudflare hosting is not blocked by desktop-only tooling.

## Work Objectives
### Core Objective
Ship OpenPencil as a CH5-standard hosted product on Cloudflare with anonymous local usage, authenticated hosted persistence, staged deployments, and reliable collaboration infrastructure, without breaking existing desktop and file-based workflows.

### Deliverables
- `config/environment-targets.json`, `config/runtime-requirements.json`, `config/hush-env-matrix.json`
- `packages/runtime-config` package for OpenPencil
- Cloudflare Worker API with Better Auth, D1 bindings, R2 bindings, Durable Object bindings
- D1 schema for users, sessions, documents, shares, collaboration metadata
- R2 document blob service for `.fig` snapshots and previews
- App-side persistence adapter for local-only vs hosted document flows
- Anonymous-local-doc import-on-sign-in flow
- Share/permission APIs and UI wiring
- Durable Object-backed collaboration service with reconnect/recovery
- Hosted AI proxy and client secret removal for hosted mode
- Staging deploy / candidate record / promote / rollback workflows and docs
- Observability, proof commands, devmux contracts, operator docs

### Definition of Done (verifiable conditions with commands)
- `bun run check` exits 0.
- `bun run test:unit` exits 0.
- `bunx vitest run tests/api` exits 0.
- `bunx playwright test tests/e2e/hosted-auth.spec.ts --project=openpencil` exits 0.
- `bunx playwright test tests/e2e/hosted-docs.spec.ts --project=openpencil` exits 0.
- `bunx playwright test tests/e2e/hosted-offline-sync.spec.ts --project=openpencil` exits 0.
- `bunx playwright test tests/e2e/hosted-sharing.spec.ts --project=openpencil` exits 0.
- `bunx playwright test tests/e2e/hosted-realtime.spec.ts --project=openpencil` exits 0.
- `pnpm deploy:validate` exits 0.
- `pnpm secrets:validate` exits 0.
- `pnpm release:candidate` records a candidate manifest without rebuild errors.
- `pnpm promote:production --candidate <id>` promotes an existing candidate without rebuilding.

### Must Have
- Anonymous local editing remains available with no account requirement.
- Hosted save/sync/share requires authentication.
- Browser IndexedDB remains an offline cache and recovery surface.
- Existing local `.fig` workflows and Tauri FS workflows continue working.
- Hosted documents can be reopened from a fresh browser session on a different device after sign-in.
- Share permissions enforce exact access control.
- Hosted AI requests route through Worker-side secrets, not browser-stored secrets.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must NOT add teams/orgs/workspaces in this plan.
- Must NOT add billing, comments, multiplayer cursors polish, template galleries, or version-history UI.
- Must NOT rewrite the scene graph or file format as part of hosting work.
- Must NOT require auth for basic anonymous local use.
- Must NOT break desktop-only MCP/automation flows while adding hosted features.
- Must NOT leave production promotion dependent on a fresh rebuild.

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- Test decision: tests-after with new Worker integration tests, browser/offline Playwright suites, and targeted unit tests per vertical slice.
- QA policy: Every task includes agent-executed happy-path and failure-path scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: operator scaffold + data/auth foundations (Tasks 1-4)

Wave 2: app integration + import + sharing (Tasks 5-7)

Wave 3: realtime + hosted AI boundary + observability/release hardening (Tasks 8-10)

### Dependency Matrix (full, all tasks)
- 1 blocks 2, 3, 4, 10
- 2 blocks 3, 4, 7, 8
- 3 blocks 5, 6, 7, 8, 9
- 4 blocks 5, 6, 8
- 5 blocks 6, 7, 8
- 6 blocks none beyond proof completion
- 7 blocks 8
- 8 blocks 10 final proof for hosted collaboration
- 9 blocks 10 hosted AI proof
- 10 blocks final verification only

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 4 tasks → unspecified-high, cloudflare-project-ops, runtime-configuration
- Wave 2 → 3 tasks → unspecified-high, auth-session-contract, deep
- Wave 3 → 3 tasks → deep, cloudflare-workers-expert, unspecified-high

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add CH5 operator scaffold for hosted OpenPencil

  (completed)

- [x] 2. Add D1 schema and document ownership model

  (completed)

- [x] 3. Add Better Auth Worker and web auth transport

  (completed)

- [x] 4. Add R2-backed hosted document service and Worker CRUD API

  (completed)

- [x] 5. Add app persistence adapter for anonymous-local vs authenticated-hosted flows

- [x] 6. Add anonymous-local import and upgrade flow on sign-in

  (completed)

- [x] 7. Add hosted sharing and permission enforcement

  (completed)

- [x] 8. Add Durable Object collaboration authority for hosted rooms

  (completed)

- [x] 9. Add hosted AI proxy and secret boundary

  (completed)

- [x] 10. Add observability, release candidate workflow, proof lanes, and operator docs

  (completed)

  **What to do**: Implement Better Auth in the Worker using D1/Drizzle, cookie-first web sessions, trusted origins from runtime-config, and an anonymous-upgrade model: anonymous local users can browse/edit locally, but hosted saves require sign-in. Build a web auth client transport that mirrors FitBot’s cookie-first behavior and forbids hosted secret material in browser storage. Support email OTP or magic-link as the initial provider set; do not include Apple/Google in MVP.
  **Must NOT do**: Must NOT require login to open the app; must NOT store hosted session secrets in localStorage.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: auth/security-sensitive Worker + client integration.
  - Skills: [`auth-session-contract`, `runtime-configuration`] — Better Auth mounting, session transport, origin contract.
  - Omitted: [`cloudflare-workers-expert`] — Worker specifics are secondary to auth contract correctness.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 5, 6, 7, 8, 9 | Blocked By: 1, 2

  **References**:
  - Pattern: `/Users/hassoncs/Workspaces/personal/fitbot/api/src/auth/better-auth.ts` — Better Auth Worker setup with D1 adapter.
  - Pattern: `/Users/hassoncs/Workspaces/personal/fitbot/app/lib/auth/authTransport.ts` — cookie-first transport idea for web.
  - Pattern: `/Users/hassoncs/Workspaces/personal/fitbot/config/runtime-requirements.json` — auth secret requirements.
  - Existing: `src/router.ts` — current route surface to extend with hosted-auth-gated views.
  - Existing: `src/composables/use-chat.ts:30-89` — current localStorage key pattern to explicitly avoid for hosted auth/session data.

  **Acceptance Criteria**:
  - [ ] `bunx vitest run tests/api/auth.spec.ts` exits 0.
  - [ ] `bunx playwright test tests/e2e/hosted-auth.spec.ts --project=openpencil` exits 0.
  - [ ] `curl -i http://127.0.0.1:8787/api/auth/session` returns authenticated session JSON after test login and unauthenticated response after logout.

  **QA Scenarios**:
  ```
  Scenario: Web login creates valid session cookie
    Tool: Playwright
    Steps: Open app, trigger sign-in, complete test OTP/magic-link flow, then request `/api/auth/session` in the same browser context.
    Expected: Session endpoint returns the signed-in user and hosted-save UI becomes enabled.
    Evidence: .sisyphus/evidence/task-3-better-auth.txt

  Scenario: Anonymous browser cannot call hosted save API
    Tool: Bash
    Steps: `curl -i -X POST http://127.0.0.1:8787/api/documents -H 'content-type: application/json' -d '{}'`
    Expected: Response is `401` or `403` with exact auth-required error payload.
    Evidence: .sisyphus/evidence/task-3-better-auth-error.txt
  ```

  **Commit**: YES | Message: `feat(auth): add better auth worker sessions` | Files: Worker auth, client auth transport, tests

- [x] 4. Add R2-backed hosted document service and Worker CRUD API

  **What to do**: Implement hosted document CRUD through the Worker. Store canonical `.fig` blobs in R2, store metadata/indexing/ownership in D1, and expose APIs for list/create/open/save/delete/recent docs. Include server-side snapshot generation rules: the canonical persisted artifact is a `.fig` snapshot in R2; D1 tracks the latest snapshot key, timestamps, preview status, and ownership. Add explicit R2 bucket separation for staging and production.
  **Must NOT do**: Must NOT store document binary payloads in D1; must NOT bypass Worker authorization checks.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: storage + API contract design.
  - Skills: [`cloudflare-workers-expert`, `api-design`] — Worker/R2 endpoints and contracts.
  - Omitted: [`auth-session-contract`] — auth foundation is already provided by Task 3.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5, 6, 8 | Blocked By: 1, 2

  **References**:
  - Pattern: `/Users/hassoncs/Workspaces/personal/fitbot/api/wrangler.toml` — R2 binding conventions.
  - Pattern: `/Users/hassoncs/Workspaces/personal/slopcade/api/src/services/git/R2Fs.ts` — Cloudflare-native R2 persistence abstraction.
  - Existing: `src/stores/editor.ts:1026-1105` — `buildFigFile`, save, and write seams for snapshot generation.
  - Existing: `README.md` — `.fig` remains the portable user-facing file format.

  **Acceptance Criteria**:
  - [ ] `bunx vitest run tests/api/documents.spec.ts` exits 0.
  - [ ] `curl http://127.0.0.1:8787/api/documents` returns signed-in user docs only.
  - [ ] `bunx playwright test tests/e2e/hosted-docs.spec.ts --project=openpencil` exits 0.

  **QA Scenarios**:
  ```
  Scenario: Save and reopen hosted document across fresh browser context
    Tool: Playwright
    Steps: Sign in, create a document, add visible content, trigger hosted save, close context, open a fresh context, sign in again, reopen from recent docs.
    Expected: Document content and title round-trip exactly from R2 + D1 metadata.
    Evidence: .sisyphus/evidence/task-4-hosted-docs.txt

  Scenario: Cross-user document list isolation
    Tool: Bash
    Steps: Seed docs for user A and user B, then call `GET /api/documents` with user A's session.
    Expected: Only user A-owned or explicitly shared docs are returned.
    Evidence: .sisyphus/evidence/task-4-hosted-docs-error.txt
  ```

  **Commit**: YES | Message: `feat(storage): add hosted document r2 service` | Files: Worker document APIs, R2 service, tests

- [x] 5. Add app persistence adapter for anonymous-local vs authenticated-hosted flows

  **What to do**: Refactor the app’s save/open/recent-doc plumbing so persistence routes through a single adapter layer that selects between local-only storage and hosted storage based on auth state and document mode. Preserve anonymous local documents, browser sticky docs, file-based `.fig` save/open, and Tauri file workflows. Add hosted recent-docs UI state and document mode metadata in the store.
  **Must NOT do**: Must NOT remove or regress current local file handle / Tauri save flows; must NOT make hosted mode the default for signed-out users.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: risky app-store integration across save/open/watch flows.
  - Skills: [`api-design`] — adapter boundaries and state transitions.
  - Omitted: [`cloudflare-workers-expert`] — this task is app-facing.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6, 7, 8 | Blocked By: 3, 4

  **References**:
  - Existing: `src/stores/editor.ts:955-1185` — source of truth for current document source, save, watch, and reload flows.
  - Existing: `src/stores/sticky-documents.ts:1-94` — anonymous local persistence and routing semantics.
  - Existing: `src/router.ts` — current route model to preserve.
  - Pattern: FitBot runtime-config + auth transport split — separate hosted state from client-local state.

  **Acceptance Criteria**:
  - [ ] `bunx vitest run tests/app/persistence-adapter.spec.ts` exits 0.
  - [ ] `bunx playwright test tests/e2e/anonymous-local-doc.spec.ts --project=openpencil` exits 0.
  - [ ] `bunx playwright test tests/e2e/hosted-docs.spec.ts --project=openpencil` exits 0 with hosted mode enabled.

  **QA Scenarios**:
  ```
  Scenario: Anonymous local doc survives reload without account
    Tool: Playwright
    Steps: Open app signed out, create doc, add content, reload tab.
    Expected: Same local doc restores from IndexedDB and no auth prompt blocks editing.
    Evidence: .sisyphus/evidence/task-5-persistence-adapter.txt

  Scenario: Signed-in hosted doc does not silently fall back to local-only mode
    Tool: Playwright
    Steps: Sign in, create hosted doc, disconnect Worker or mock API save failure, trigger save.
    Expected: UI reports hosted save failure explicitly and preserves pending local cache without pretending save succeeded.
    Evidence: .sisyphus/evidence/task-5-persistence-adapter-error.txt
  ```

  **Commit**: YES | Message: `refactor(app): add local-or-hosted persistence adapter` | Files: app store/composables/UI/tests

- [x] 6. Add anonymous-local import and upgrade flow on sign-in

  **What to do**: Implement the post-sign-in import experience for local anonymous documents. Default behavior: detect locally persisted anonymous docs, present an explicit import chooser, import selected docs into the signed-in account, and retain local copies until hosted save succeeds. Prevent duplicate imports with a deterministic local-to-cloud mapping record.
  **Must NOT do**: Must NOT auto-import every local doc silently; must NOT delete local-only docs before hosted import confirmation.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: subtle migration edge cases and user data safety.
  - Skills: [`auth-session-contract`] — auth transition semantics.
  - Omitted: [`cloudflare-workers-expert`] — not Worker-heavy.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: none | Blocked By: 3, 4, 5

  **References**:
  - Existing: `src/stores/sticky-documents.ts` — local anonymous document inventory.
  - Existing: `src/stores/editor.ts` — current document naming and save semantics.
  - Metis directive: import must be explicit and duplicate-safe.

  **Acceptance Criteria**:
  - [ ] `bunx vitest run tests/app/local-import.spec.ts` exits 0.
  - [ ] `bunx playwright test tests/e2e/local-to-cloud-import.spec.ts --project=openpencil` exits 0.

  **QA Scenarios**:
  ```
  Scenario: Signed-in user imports selected local document into cloud account
    Tool: Playwright
    Steps: Create anonymous local doc, sign in, choose that doc in import dialog, confirm import, open recent hosted docs.
    Expected: Imported doc appears in cloud index and remains editable locally and remotely.
    Evidence: .sisyphus/evidence/task-6-local-import.txt

  Scenario: Duplicate import attempt is deduplicated
    Tool: Playwright
    Steps: Import the same local doc twice through the upgrade flow.
    Expected: Second attempt surfaces existing hosted mapping instead of creating a second cloud copy.
    Evidence: .sisyphus/evidence/task-6-local-import-error.txt
  ```

  **Commit**: YES | Message: `feat(app): add anonymous document import on sign-in` | Files: app import UI/store/API tests

- [x] 7. Add hosted sharing and permission enforcement

  **What to do**: Implement document sharing for hosted docs with single-owner authority and collaborator roles `viewer` and `editor`. Support v1 sharing via invite or generated link token with explicit role assignment; the plan default is invite-or-link without teams. Enforce permissions in Worker APIs and collaboration handshake, and surface permission-aware UI states in the app.
  **Must NOT do**: Must NOT add team workspaces, comments, or public template publishing; must NOT let unsigned users access private docs unless granted by a share token flow.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: authz-sensitive cross-cutting feature.
  - Skills: [`api-design`, `auth-session-contract`] — permission model and session-aware authorization.
  - Omitted: [`cloudflare-artifact-promotion`] — release process is unrelated here.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8 | Blocked By: 2, 3, 5

  **References**:
  - Pattern: FitBot Better Auth + D1 ownership model (`api/src/auth/better-auth.ts`, `api/src/db/schema.ts`).
  - Existing: `src/components/CollabPanel.vue` — current share UI surface to evolve.
  - Existing: `src/router.ts` — `/share/:roomId` route to adapt from anonymous room IDs to permissioned hosted docs.

  **Acceptance Criteria**:
  - [ ] `bunx vitest run tests/api/sharing.spec.ts` exits 0.
  - [ ] `bunx playwright test tests/e2e/hosted-sharing.spec.ts --project=openpencil` exits 0.

  **QA Scenarios**:
  ```
  Scenario: Owner shares document to collaborator with editor role
    Tool: Playwright
    Steps: User A signs in, shares doc to User B, User B opens shared doc and edits content.
    Expected: User B can edit and User A sees persisted changes after refresh.
    Evidence: .sisyphus/evidence/task-7-sharing.txt

  Scenario: Unauthorized user is denied access
    Tool: Bash
    Steps: User C requests shared document endpoint without invite/share permission.
    Expected: Response is exact `403` with permission-denied payload; no document metadata leaks.
    Evidence: .sisyphus/evidence/task-7-sharing-error.txt
  ```

  **Commit**: YES | Message: `feat(api): add hosted document sharing permissions` | Files: Worker authz/services/app sharing UI/tests

- [x] 8. Add Durable Object collaboration authority for hosted rooms

  **What to do**: Add Durable Object-backed hosted collaboration for authenticated/shared documents. Preserve Yjs as the live collaboration representation. The DO owns room membership, websocket session auth, presence, reconnect handling, and live state fan-out. It periodically materializes or flushes settled Yjs state back into the R2 canonical `.fig` snapshot path via the Worker save pipeline. Keep Trystero-based anonymous local sharing available only for legacy/local mode until hosted collab is proven, but hosted docs must use the DO path.
  **Must NOT do**: Must NOT depend on public MQTT brokers for hosted collaboration; must NOT require realtime collaboration for basic hosted save/load.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: realtime architecture, reconnect semantics, data convergence.
  - Skills: [`cloudflare-workers-expert`, `cf-do-websocket-hibernation`] — DO websocket lifecycle and hibernation patterns.
  - Omitted: [`api-design`] — contract work is already defined by previous tasks.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 10 | Blocked By: 2, 3, 4, 5, 7

  **References**:
  - Pattern: `/Users/hassoncs/Workspaces/personal/slopcade/api/src/party/PartyRoomDO.ts` — websocket/session lifecycle patterns.
  - Pattern: `/Users/hassoncs/Workspaces/personal/fitbot/api/src/RealtimeRelayDO.ts` — Worker DO binding and auth-wrapped websocket relay pattern.
  - Existing: `src/composables/use-collab.ts:86-358` — current Yjs document, awareness, and sync seams.
  - Existing: `src/components/CollabPanel.vue` — hosted share/join UX touchpoint.

  **Acceptance Criteria**:
  - [ ] `bunx vitest run tests/api/realtime.spec.ts` exits 0.
  - [ ] `bunx playwright test tests/e2e/hosted-realtime.spec.ts --project=openpencil` exits 0.
  - [ ] DO reconnect test demonstrates state convergence after forced reconnect.

  **QA Scenarios**:
  ```
  Scenario: Two authenticated clients edit same hosted document and converge
    Tool: Playwright
    Steps: Launch two signed-in browser contexts, open the same shared doc, edit in both contexts.
    Expected: Both clients converge on the same content and the settled state survives refresh.
    Evidence: .sisyphus/evidence/task-8-hosted-realtime.txt

  Scenario: Collaboration survives forced reconnect
    Tool: Playwright
    Steps: Open two shared clients, force websocket disconnect or DO recycle, reconnect both clients.
    Expected: Clients reconnect, restore membership, and converge without duplicating or losing edits.
    Evidence: .sisyphus/evidence/task-8-hosted-realtime-error.txt
  ```

  **Commit**: YES | Message: `feat(realtime): add hosted collaboration durable object` | Files: Worker DO, app collab adapter, tests

- [x] 9. Add hosted AI proxy and secret boundary

  **What to do**: Move hosted AI and image generation requests behind Worker endpoints so hosted-mode users never need to store provider secrets in browser `localStorage`. Preserve BYOK only for local/desktop mode as an explicit non-hosted option. Add runtime-config/Hush secret requirements for hosted AI providers and client UI gating between local-BYOK mode and hosted-managed mode.
  **Must NOT do**: Must NOT break existing local BYOK workflows for anonymous/local use; must NOT ship hosted provider secrets to the client.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: security-sensitive feature boundary and UX split.
  - Skills: [`runtime-configuration`, `cloudflare-workers-expert`] — secret delivery and Worker proxying.
  - Omitted: [`auth-session-contract`] — auth basis already exists.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 10 | Blocked By: 3

  **References**:
  - Existing: `src/composables/use-chat.ts:30-223` — current localStorage provider/key flow to split.
  - Existing: `vite.config.ts:182-233` — current dev-only Scenario proxy pattern to replace with Worker-hosted path.
  - Pattern: FitBot runtime-requirements + Hush secret projection model.

  **Acceptance Criteria**:
  - [ ] `bunx vitest run tests/api/ai-proxy.spec.ts` exits 0.
  - [ ] `bunx playwright test tests/e2e/hosted-ai.spec.ts --project=openpencil` exits 0.
  - [ ] Hosted mode stores no provider secret material in browser localStorage after sign-in.

  **QA Scenarios**:
  ```
  Scenario: Hosted user runs AI action without entering provider key
    Tool: Playwright
    Steps: Sign in to hosted mode, invoke an AI action using managed provider settings.
    Expected: Request succeeds through Worker proxy and no provider secret is persisted client-side.
    Evidence: .sisyphus/evidence/task-9-hosted-ai.txt

  Scenario: Hosted request without configured server secret fails safely
    Tool: Bash
    Steps: Call hosted AI endpoint with server secret intentionally absent in test config.
    Expected: Endpoint returns explicit configuration error without leaking stack traces or partial secret info.
    Evidence: .sisyphus/evidence/task-9-hosted-ai-error.txt
  ```

  **Commit**: YES | Message: `feat(ai): proxy hosted ai through worker` | Files: Worker AI proxy, app provider UI, tests

- [x] 10. Add observability, release candidate workflow, proof lanes, and operator docs

  **What to do**: Finish the CH5 operator layer by adding Sentry/PostHog/logging hooks, named proof lanes and scripts, staging deploy workflow from `main`, release candidate manifest recording, manual production promote/rollback workflows, and operator docs/entrypoints that describe staging, secrets, migrations, deploy recovery, and collaboration recovery. Add devmux hostnames and health checks for web + api. Ensure local/worker tests and Playwright hosted suites are first-class proof commands.
  **Must NOT do**: Must NOT leave deploy state undocumented; must NOT rely on ad hoc manual rollback steps.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: release engineering, docs, telemetry, and proof lanes.
  - Skills: [`golden-project-operator-standard`, `cloudflare-artifact-promotion`, `testing-lanes-bootstrap`] — operator hardening and release model.
  - Omitted: [`cloudflare-workers-expert`] — runtime internals are already handled.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: final verification only | Blocked By: 1, 8, 9

  **References**:
  - Pattern: `/Users/hassoncs/Workspaces/personal/fitbot/.github/workflows/deploy-staging.yml` — staging auto-deploy + candidate record.
  - Pattern: `/Users/hassoncs/Workspaces/personal/fitbot/.github/workflows/promote-production.yml` — promote without rebuild.
  - Pattern: `/Users/hassoncs/Workspaces/personal/fitbot/.github/workflows/rollback-production.yml` — rollback from recorded candidate.
  - Pattern: `/Users/hassoncs/Workspaces/personal/fitbot/devmux.config.json` — deterministic hostnames/health checks.
  - Pattern: `/Users/hassoncs/Workspaces/personal/fitbot/docs/API_ROUTE_TEST_COVERAGE.md` — explicit proof-lane documentation.

  **Acceptance Criteria**:
  - [ ] `pnpm release:candidate` exits 0 and writes a candidate manifest.
  - [ ] `pnpm promote:production --candidate <test-id> --dry-run` exits 0.
  - [ ] `pnpm rollback:production --candidate <test-id> --dry-run` exits 0.
  - [ ] `pnpm proof:hosted` exits 0 and runs the named hosted proof lane.

  **QA Scenarios**:
  ```
  Scenario: Candidate promotion path is recorded and replayable
    Tool: Bash
    Steps: Run `pnpm release:candidate` in staging config, inspect manifest, then run `pnpm promote:production --candidate <id> --dry-run`.
    Expected: Candidate manifest includes web/api/storage verification metadata and promotion dry-run resolves the existing candidate without rebuilding.
    Evidence: .sisyphus/evidence/task-10-operator-hardening.txt

  Scenario: Hosted proof lane fails when a required suite regresses
    Tool: Bash
    Steps: Trigger `pnpm proof:hosted` with one required suite intentionally failing in the test fixture.
    Expected: Proof lane exits non-zero and names the failed hosted verification lane.
    Evidence: .sisyphus/evidence/task-10-operator-hardening-error.txt
  ```

  **Commit**: YES | Message: `docs(operator): add hosted release and proof lanes` | Files: workflows, scripts, docs, telemetry wiring, devmux config

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Commit after each numbered task; keep auth/schema/storage/realtime separate.
- Do not combine operator scaffold, auth, and storage into one mega-commit.
- Land realtime only after hosted auth, document save/load, and sharing are stable.
- Preserve green proof lanes after each task-specific commit.

## Success Criteria
- OpenPencil can be used anonymously with no sign-in for local-only work.
- A signed-in user can create, save, reopen, and share hosted documents across devices.
- Hosted documents persist canonically in R2 with metadata and ownership in D1.
- Collaboration on hosted documents no longer depends on public MQTT signaling or peer-only persistence.
- Hosted AI flows use Worker-side secrets only; browser no longer needs managed provider secrets.
- The project has CH5-standard operator artifacts, staged deploys, candidate promotion/rollback, proof commands, Hush mapping, and docs.
- Existing desktop/local file workflows remain intact.
