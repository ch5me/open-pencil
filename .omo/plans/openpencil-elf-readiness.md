# OpenPencil ELF Readiness

## TL;DR
> **Summary**: Prepare OpenPencil to adopt ELF auth, hosted document storage, and hosted collaboration without blocking on ELF platform readiness. Build the contracts, adapters, runtime topology, and verification lanes now; defer only the final ELF-bound integrations and desktop auth handoff.
> **Deliverables**:
> - auth/session contract for web-first hosted mode
> - auth-package alignment plan between `firefly-cloud`, `ch5-packages`, and OpenPencil
> - public-facing auth naming alignment plan using `ELF` terminology everywhere external
> - document persistence adapter boundary supporting local + hosted modes
> - hosted backend scaffold for D1/R2/Durable Objects aligned to `.ch5/services.yaml`
> - hosted collaboration architecture replacing public Trystero signaling behind a feature gate
> - rollout and migration plan preserving current local-first editing
> **Effort**: XL
> **Parallel**: YES - 7 waves
> **Critical Path**: 1 → 2 → 4 → 7 → 10 → F1-F4

## Context
### Original Request
Prepare OpenPencil so it can plug into ELF custom auth, future ELF cloud file storage, and hosted collaboration as soon as the ELF platform is ready. Billing is out of scope. OpenPencil remains a sub-app of ELF.

### Interview Summary
- Auth provider is fixed: `@ch5me/elf-auth-client`
- Billing is explicitly excluded
- Tests strategy is `tests-after`
- Desktop deep-link/callback auth readiness is deferred until web/API hosted flows are proven
- The user wants a full readiness plan, not a partial spike

### Metis Review (gaps addressed)
- Separate `build-now seams` from `platform-dependent integrations`
- Define canonical identities for `user`, `document`, `room`, `asset`, `snapshot`
- Preserve local-first mode through migration; do not regress offline/local docs
- Keep hosted collaboration gated until auth + hosted document identity are stable
- Exclude scope creep: billing, org admin, broad permissions matrix, full version history, desktop auth implementation, full offline sync engine

## Work Objectives
### Core Objective
Make OpenPencil implementation-ready for ELF-hosted auth, cloud documents, and hosted collaboration by establishing all application seams, runtime scaffolding, data contracts, migration rules, and verification lanes required to integrate quickly once ELF auth/runtime dependencies are live.

### Deliverables
- Canonical `@ch5me/elf-auth-client` package alignment plan and source-of-truth decision
- Public naming policy and rename map for tokens, keys, env vars, docs, endpoints, and payload fields that should say `ELF`, not `Kilo`
- Web/API auth readiness architecture using ELF session verification
- Hosted document persistence architecture using D1 + R2
- Hosted collaboration architecture using Durable Objects + Yjs
- Local/hosted dual-mode document and collaboration model
- Environment/runtime topology for local, preview, staging, and production
- Migration rules for existing local `.fig` / `.pen` workflows
- CI, proof, and rollout gates for hosted-mode adoption

### Definition of Done (verifiable conditions with commands)
- Hosted-readiness codepaths are fully planned with explicit file targets, contracts, and acceptance criteria
- Local-first flows remain supported and explicitly tested in the plan
- Every hosted capability is assigned to a concrete runtime surface already declared in repo config
- Feature-gated rollout order is explicit and reversible
- Verification lanes reference real project commands such as `bun run check`, `bun run test`, `bun run test:unit`, `bun run test:figma`, and hosted proof extensions to be added

### Must Have
- One canonical auth package source of truth with unified payload schema and consumer contract
- A clear naming doctrine: external/public auth surfaces use `ELF`; `Firefly` remains codename/internal where appropriate; `Kilo` is removed from public-facing auth/token naming
- Cookie-first web session contract with explicit future bearer fallback seam for desktop/native
- `DocumentBackend` abstraction covering local file backend and hosted backend
- Canonical hosted identities for document ownership, room ownership, assets, and snapshots
- Durable Object room architecture aligned with existing Yjs model
- R2 split between document snapshots and binary assets
- D1 schema planning for users, documents, rooms, memberships/access, asset metadata, snapshots
- Preview/staging/prod environment rules consistent with `.ch5/environments.yaml`
- Hosted mode behind feature flags / operating modes

### Must NOT Have
- No billing work
- No assumption that ELF auth/runtime is already available
- No OpenPencil dependency on a split or contradictory auth package contract
- No public-facing token, key, endpoint, or package naming that still exposes `Kilo`
- No broad product expansion into comments, org admin, generalized permissions matrix, or full history product surface
- No desktop auth implementation in initial waves
- No replacement of current local-only editing as the only available mode
- No public-broker Trystero dependence in hosted mode

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- Test decision: `tests-after` using existing `bun:test`, Playwright, package smoke checks, and new hosted/API proof lanes
- QA policy: Every task includes agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. Extract shared contracts first to maximize downstream parallelism.

Wave 1: architecture contracts and operating modes
Wave 2: hosted backend scaffold and environment topology
Wave 3: auth/session seams and frontend route gating design
Wave 4: hosted document persistence and migration model
Wave 5: hosted collaboration transport and room model
Wave 6: verification, CI, deploy, and feature-gate rollout
Wave 7: deferred desktop readiness and final integration cleanup

### Dependency Matrix (full, all tasks)
- 1 blocks 2, 3, 4, 5, 6
- 2 blocks 8, 9
- 3 blocks 10, 12
- 4 blocks 7, 10, 11
- 5 blocks 11
- 6 blocks 13
- 7 blocks 8, 10, 11
- 8 blocks 9, 10, 11
- 9 blocks 12, 13
- 10 blocks 13
- 11 blocks 13
- 12 blocks 13
- 13 blocks F1-F4

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 3 tasks → `deep`, `unspecified-high`, `deep`
- Wave 2 → 2 tasks → `unspecified-high`, `quick`
- Wave 3 → 2 tasks → `unspecified-high`, `deep`
- Wave 4 → 2 tasks → `unspecified-high`, `deep`
- Wave 5 → 2 tasks → `unspecified-high`, `deep`
- Wave 6 → 1 task → `unspecified-high`
- Wave 7 → 1 task → `quick`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Define hosted operating modes and canonical identities

  **What to do**: Define the application operating modes as `local-only`, `hosted-auth + local-docs`, `hosted-docs single-user`, and `hosted-collab`. Specify canonical identifiers and ownership rules for `user`, `document`, `room`, `asset`, and `snapshot`, including how local `.pen` / `.fig` documents map to hosted documents and how room identity derives from document identity.
  **Must NOT do**: Do not introduce org/workspace multi-tenancy, comments, billing concepts, or full permissions matrices.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: this is the core contract that prevents downstream auth/storage/collab drift
  - Skills: [`auth-session-contract`] — why needed: session and transport rules must align with hosted identity model
  - Omitted: [`ch5-auth`] — why not needed: this task defines contracts, not concrete Better Auth-style implementation

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [2,3,4,5,6] | Blocked By: []

  **References**:
  - Pattern: `AGENTS.md:3` — target-state federation intent and ELF sub-app positioning
  - Pattern: `src/router.ts` — current route model with `/share/:roomId` and no hosted document route
  - Pattern: `src/app/collab/room.ts` — current room identity is freeform room ID, must be replaced/abstracted for hosted mode
  - Pattern: `src/app/document/io/source.ts` — current document source model is local-file oriented
  - External: auth-session-contract skill — cookie-first web / bearer fallback doctrine

  **Acceptance Criteria**:
  - [ ] A written contract exists in code-facing docs identifying the four operating modes and exact transition rules between them
  - [ ] The hosted identity model explicitly defines whether hosted room ID equals document ID or derives deterministically from it
  - [ ] The local-to-hosted import path is specified for both `.pen` and `.fig` inputs without ambiguity

  **QA Scenarios**:
  ```
  Scenario: Validate operating-mode coverage
    Tool: Bash
    Steps: Review the authored contract artifact and assert it contains all four modes plus user/document/room/asset/snapshot identity definitions
    Expected: All required modes and identities are documented with no missing contract fields
    Evidence: .sisyphus/evidence/task-1-operating-modes.txt

  Scenario: Validate route and identity alignment
    Tool: Bash
    Steps: Compare authored contract against current route/doc/collab code references and ensure hosted route replacements are specified
    Expected: No current local-only identifier remains undocumented in migration rules
    Evidence: .sisyphus/evidence/task-1-operating-modes-error.txt
  ```

  **Commit**: YES | Message: `docs(readiness): define hosted operating modes and identities` | Files: `.llm/wiki/`, `AGENTS.md`, readiness docs

- [x] 2. Unify the ELF auth package source of truth and payload contract

  **What to do**: Choose the canonical package source of truth as `@ch5me/elf-auth-client` from `ch5-packages`, reconcile it with the unscoped `elf-auth-client` copy inside `firefly-cloud`, and unify the payload schema, naming, exports, tests, and publish story. Resolve the `kiloUserId` vs `fireflyUserId` split by adopting ELF/public-safe terminology everywhere public-facing, decide the authoritative token payload fields, and define migration rules for every consumer.
  **Must NOT do**: Do not let OpenPencil consume a package while two incompatible variants still exist. Do not broaden the package into a fake full auth SDK unless Firefly web actually uses that surface.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: this is a cross-repo contract and naming decision that can invalidate every sub-app integration if wrong
  - Skills: [`software-design-principles`] — why needed: package boundary and contract discipline matter more than implementation volume
  - Omitted: [`ch5-auth`] — why not needed: this task is package/contract alignment, not app auth wiring

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [8,9] | Blocked By: [1]

  **References**:
  - Pattern: `../ch5-packages/packages/auth/elf-auth-client/src/index.ts` — scoped canonical candidate implementation
  - Pattern: `../ch5-packages/packages/auth/elf-auth-client/src/types.ts` — current `kiloUserId` payload variant
  - Pattern: `../firefly-cloud/packages/elf-auth-client/index.js` — unscoped duplicate implementation
  - Pattern: `../firefly-cloud/packages/elf-auth-client/types.d.ts` — current `fireflyUserId` payload variant
  - Pattern: `../firefly-cloud/services/session-ingest/src/middleware/firefly-jwt-auth.ts` — live consumer of the unscoped package
  - Pattern: `../firefly-cloud/docs/elf-auth-topology.md` — current hosted auth topology truth
  - Pattern: `../ch5-company/elf-auth-cutover-spec.md` — directional but partially stale package/auth cutover spec

  **Acceptance Criteria**:
  - [ ] A single canonical package location and publish name is declared
  - [ ] The payload schema no longer has divergent identity field names across variants and no public-facing field still uses `Kilo`
  - [ ] Every known consumer has an explicit migration note or update path to the unified package contract

  **QA Scenarios**:
  ```
  Scenario: Package contract diff audit
    Tool: Bash
    Steps: Compare the scoped and unscoped package exports, types, and payload fields before and after alignment work
    Expected: There is no remaining schema or export drift between package variants because only one canonical contract remains
    Evidence: .sisyphus/evidence/task-2-auth-package-alignment.txt

  Scenario: Consumer compatibility audit
    Tool: Bash
    Steps: Run package tests and consumer contract checks against known Firefly consumers
    Expected: All listed consumers either pass against the unified contract or are explicitly migrated in the same slice
    Evidence: .sisyphus/evidence/task-2-auth-package-alignment-error.txt
  ```

  **Commit**: YES | Message: `refactor(auth): unify elf auth package contract` | Files: `ch5-packages`, `firefly-cloud`, tests/docs

- [x] 3. Define public auth naming doctrine and rename map

  **What to do**: Establish a project-wide naming policy for auth-related public surfaces: package names, JWT payload fields, endpoint names, env vars, docs, token names, and key names that are externally visible or intended for sub-app integration. `ELF` is the external namespace. `Firefly` is the internal codename/platform name where appropriate. `Kilo` must be removed from public-facing auth/token/key naming. Produce a rename matrix and exact compatibility/deprecation rules.
  **Must NOT do**: Do not rename internal historical comments or unrelated runtime concepts unnecessarily. Do not leave naming ambiguous across docs and code.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: naming is contract surface here, not cosmetics
  - Skills: [`software-design-principles`] — why needed: contract vocabulary and public/internal boundary discipline matter
  - Omitted: [`ch5-auth`] — why not needed: this is naming doctrine first, not provider behavior

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [8,9,10] | Blocked By: [1]

  **References**:
  - Pattern: `../firefly-cloud/docs/elf-auth-topology.md` — already uses ELF externally
  - Pattern: `../ch5-company/elf-auth-cutover-spec.md` — contains legacy Kilo naming that must be normalized for public-facing surfaces
  - Pattern: `../ch5-packages/packages/auth/elf-auth-client/src/types.ts` — package payload contract candidate
  - Pattern: `../firefly-cloud/apps/firefly-api/src/auth/resolve-session.ts` — current mixed internal naming surfaces

  **Acceptance Criteria**:
  - [ ] A written naming doctrine exists distinguishing external/public `ELF` naming from internal `Firefly` codename usage
  - [ ] A rename matrix lists every public-facing token/key/endpoint/package/payload field that must change
  - [ ] Compatibility/deprecation handling is specified for any renamed API or token field

  **QA Scenarios**:
  ```
  Scenario: Public naming inventory audit
    Tool: Bash
    Steps: Search authoritative repos/docs for public-facing auth/token naming and compare against the rename matrix
    Expected: Every public-facing `Kilo` auth/token/key reference is either renamed or explicitly documented as temporary compatibility debt
    Evidence: .sisyphus/evidence/task-3-auth-naming.txt

  Scenario: Naming doctrine consistency check
    Tool: Bash
    Steps: Validate docs/package/API naming against the doctrine after updates
    Expected: External surfaces use `ELF`; internal-only codename usage is intentional and documented
    Evidence: .sisyphus/evidence/task-3-auth-naming-error.txt
  ```

  **Commit**: YES | Message: `docs(auth): define elf public naming doctrine` | Files: docs/specs/package contracts

- [x] 4. Introduce backend runtime scaffold aligned to `.ch5/services.yaml`

  **What to do**: Create the committed API worker scaffold under `api/` that matches declared CH5 topology: Cloudflare Worker entry, D1 binding, R2 bindings for documents/assets, Durable Object registration for `DocumentRoomDO`, env typing, migrations folder, and explicit local/staging/prod config. This scaffold must compile even if final ELF auth endpoints are not live.
  **Must NOT do**: Do not implement billing, production business logic, or fake final ELF auth internals.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: scaffold spans Worker runtime, config, bindings, and migrations
  - Skills: [`cloudflare-workers-expert`] — why needed: Worker/D1/R2/DO config must follow Cloudflare best practices
  - Omitted: [`terraform-module-library`] — why not needed: this is repo-local runtime scaffolding, not infra-as-code abstraction work

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [10,11] | Blocked By: [1]

  **References**:
  - Pattern: `.ch5/services.yaml` — authoritative hosted service topology already declared
  - Pattern: `.ch5/environments.yaml` — environment separation already declared
  - Pattern: `.github/workflows/app.yml` — existing web deploy flow to align with later API deploy workflow
  - Pattern: `packages/mcp/src/auth.ts` — existing minimal token surface can inform temporary auth plumbing only
  - External: Cloudflare Worker + Durable Objects + R2 guidance from librarian research

  **Acceptance Criteria**:
  - [ ] `api/` contains committed source and config files required to boot a Worker with D1/R2/DO bindings in local dev
  - [ ] The runtime config maps cleanly to local, preview, staging, and production without unnamed envs
  - [ ] Worker scaffold starts without requiring live ELF auth dependencies

  **QA Scenarios**:
  ```
  Scenario: Start Worker scaffold locally
    Tool: Bash
    Steps: Run the worker dev command from the new scaffold with local env bindings stubbed
    Expected: Worker starts and exposes health/status endpoint without runtime binding errors
    Evidence: .sisyphus/evidence/task-2-api-scaffold.txt

  Scenario: Validate config topology
    Tool: Bash
    Steps: Inspect config and bindings against `.ch5/services.yaml` and `.ch5/environments.yaml`
    Expected: DB, DOCUMENTS, ASSETS, and DOCUMENT_ROOM bindings all exist with no topology mismatch
    Evidence: .sisyphus/evidence/task-2-api-scaffold-error.txt
  ```

  **Commit**: YES | Message: `feat(api): scaffold hosted worker runtime` | Files: `api/`, `migrations/`, runtime config files

- [x] 5. Add document persistence adapter boundary for local and hosted modes

  **What to do**: Refactor document I/O around an explicit `DocumentBackend` abstraction that supports current local-file behavior and planned hosted CRUD behavior without changing editor core contracts. Define backend capabilities, source metadata, hosted/local save semantics, autosave routing, and error states.
  **Must NOT do**: Do not directly wire hosted logic into Tauri/browser file helpers. Do not replace current local file source behavior.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: this seam protects the editor from future storage rewrites
  - Skills: [`software-design-principles`] — why needed: interface decomposition and boundary quality matter here
  - Omitted: [`cloudflare-workers-expert`] — why not needed: this task is app-side abstraction first

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [12,13] | Blocked By: [1]

  **References**:
  - Pattern: `src/app/document/io/source.ts` — current document-source orchestration
  - Pattern: `src/app/document/io/save.ts` — current save coordinator across backends
  - Pattern: `src/app/document/io/write.ts` — current local write implementations
  - Pattern: `src/app/document/autosave/create.ts` — current autosave hooks and timing
  - Pattern: `src/app/document/io/read.ts` — current local read/open flow

  **Acceptance Criteria**:
  - [ ] Local-file behavior remains intact behind the new abstraction
  - [ ] Hosted backend contract explicitly covers open/save/saveAs/autosave/load metadata/capability detection
  - [ ] The abstraction documents which operations are legal in each operating mode

  **QA Scenarios**:
  ```
  Scenario: Local document regression check
    Tool: Playwright
    Steps: Open a local `.pen` or `.fig`, edit it, trigger save, reload it
    Expected: Current local save/open workflow still works unchanged through the new adapter boundary
    Evidence: .sisyphus/evidence/task-3-document-backend.png

  Scenario: Hosted backend contract validation
    Tool: Bash
    Steps: Run unit/integration tests for backend capability selection and invalid operation handling
    Expected: Hosted-only and local-only capability mismatches fail with explicit typed errors
    Evidence: .sisyphus/evidence/task-3-document-backend-error.txt
  ```

  **Commit**: YES | Message: `refactor(io): introduce document backend abstraction` | Files: `src/app/document/io/`, tests

- [x] 6. Define web auth/session resolution integration around ELF client

  **What to do**: Implement the web-facing auth/session integration seam using `@ch5me/elf-auth-client` assumptions: cookie-first web session resolution in the Worker, route guards in the app for hosted-only surfaces, session bootstrap APIs, and feature flags that keep local-only mode available when unauthenticated. Add stubs/mocks where ELF runtime is not yet live.
  **Must NOT do**: Do not implement desktop deep-link auth or store bearer tokens in the browser. Do not force auth for local-only mode.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: spans worker session APIs and app route/access behavior
  - Skills: [`auth-session-contract`, `ch5-auth`] — why needed: session resolver doctrine and CH5 auth patterns should inform the seam
  - Omitted: [`workos`] — why not needed: WorkOS is not the chosen auth surface

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [12,13] | Blocked By: [1]

  **References**:
  - Pattern: `AGENTS.md:5` — explicit federation/auth target
  - Pattern: `src/router.ts` — no current auth guards; hosted surfaces will need them
  - Pattern: `src/views/EditorView.vue` — app bootstrap point for hosted session bootstrap/fallback mode
  - Pattern: `packages/mcp/src/auth.ts` — simple auth surface to replace/extend in hosted context where appropriate
  - External: auth-session-contract skill and librarian findings on cookie-first + RS256/JWKS verification

  **Acceptance Criteria**:
  - [ ] Unauthenticated users can still use approved local-only flows while hosted routes and hosted docs are gated
  - [ ] Worker session resolution is specified and testable independently of the final live ELF auth service
  - [ ] Hosted route guarding and session bootstrap behavior are explicit for local, preview, staging, and production

  **QA Scenarios**:
  ```
  Scenario: Hosted route requires session
    Tool: Playwright
    Steps: Open a hosted-only route without a valid session cookie, then with a mocked valid session
    Expected: Unauthenticated access redirects/blocks; authenticated access succeeds
    Evidence: .sisyphus/evidence/task-4-web-auth.png

  Scenario: Session resolver conflict handling
    Tool: Bash
    Steps: Run Worker tests for cookie-only success, missing session failure, and mocked invalid session handling
    Expected: Resolver returns explicit unauthorized/unauthenticated outcomes with no silent fallthrough
    Evidence: .sisyphus/evidence/task-4-web-auth-error.txt
  ```

  **Commit**: YES | Message: `feat(auth): add web session readiness seams` | Files: `api/`, `src/router.ts`, auth/session modules, tests

- [x] 7. Model hosted document schema, ownership, and migration rules

  **What to do**: Define and implement the D1-backed hosted document model: document metadata, owner identity, snapshot metadata, asset metadata, and local-to-hosted migration metadata. Specify import, promote-to-hosted, duplicate, and unsupported transition rules for existing local docs.
  **Must NOT do**: Do not build broad sharing/ACL product features or org-level ownership in this phase.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: data model mistakes here will force painful rewrites later
  - Skills: [`software-design-principles`] — why needed: schema and lifecycle need clean long-term seams
  - Omitted: [`terraform-module-library`] — why not needed: storage modeling is application-level, not IaC-level

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [13] | Blocked By: [1]

  **References**:
  - Pattern: `.ch5/services.yaml` — declares D1 + documents/assets buckets already
  - Pattern: `src/app/document/io/source.ts` — current source metadata model to extend rather than replace blindly
  - Pattern: `src/app/document/io/read.ts` — current open/import flow for local files
  - Pattern: `src/app/document/io/save-targets.ts` — current target selection behavior that hosted mode must complement
  - External: librarian guidance on R2 snapshots/assets + D1 metadata split

  **Acceptance Criteria**:
  - [ ] Hosted document schema includes owner identity, storage keys, snapshot lineage, and migration metadata
  - [ ] The plan specifies exactly how a local document becomes a hosted document
  - [ ] Unsupported flows (for example hosted auth absent, asset missing, or no ownership) return explicit failure states

  **QA Scenarios**:
  ```
  Scenario: Promote local doc to hosted metadata
    Tool: Bash
    Steps: Run schema/service tests that simulate importing a local `.pen` and creating hosted metadata records
    Expected: Document, snapshot, and asset metadata are created consistently with owner and source lineage
    Evidence: .sisyphus/evidence/task-5-doc-schema.txt

  Scenario: Reject invalid migration state
    Tool: Bash
    Steps: Simulate promote-to-hosted with missing session or malformed source metadata
    Expected: Operation fails with explicit typed error and no partial record creation
    Evidence: .sisyphus/evidence/task-5-doc-schema-error.txt
  ```

  **Commit**: YES | Message: `feat(storage): define hosted document metadata model` | Files: migrations, storage/domain docs, tests

- [x] 8. Establish feature flags and environment topology for hosted rollout

  **What to do**: Define repo-managed feature flags and runtime env rules for enabling hosted auth, hosted documents, and hosted collaboration independently across local, preview, staging, and production. Align these flags with `.ch5/environments.yaml`, Pages deploys, and future Worker deployment.
  **Must NOT do**: Do not hide critical mode behavior in ad hoc booleans or hardcoded host checks.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: bounded configuration/topology work once contracts are known
  - Skills: [`runtime-configuration`] — why needed: stage/surface/env contract must be explicit
  - Omitted: [`cloudflare-workers-expert`] — why not needed: config topology is primary; implementation can follow later

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [13] | Blocked By: [1]

  **References**:
  - Pattern: `.ch5/environments.yaml` — current declared env topology
  - Pattern: `.ch5/project.yaml` — runtime identity
  - Pattern: `.github/workflows/app.yml` — existing Pages deploy behavior
  - Pattern: `.github/workflows/preview.yml` — existing preview branch deploy behavior
  - Pattern: `package.json` proof/test scripts — verification lanes to extend per mode

  **Acceptance Criteria**:
  - [ ] Hosted auth/docs/collab are independently switchable by environment and feature gate
  - [ ] Preview/staging/production callback URLs and hosted API origins are explicitly defined
  - [ ] No feature gate relies on implicit environment guessing

  **QA Scenarios**:
  ```
  Scenario: Validate environment matrix
    Tool: Bash
    Steps: Run config validation across local, preview, staging, and production env files/typed config
    Expected: Each environment resolves a complete feature-gate and runtime topology set
    Evidence: .sisyphus/evidence/task-6-feature-flags.txt

  Scenario: Validate disabled hosted mode
    Tool: Playwright
    Steps: Run app with hosted flags disabled and confirm local-only flows still work while hosted UI remains hidden/inactive
    Expected: No hosted-only route or action leaks into local-only mode
    Evidence: .sisyphus/evidence/task-6-feature-flags-error.png
  ```

  **Commit**: YES | Message: `chore(runtime): add hosted rollout feature gates` | Files: env config, runtime config docs, tests

- [x] 9. Align Firefly Cloud consumers to the unified auth package contract

  **What to do**: Update Firefly Cloud consumers and docs to the unified auth package contract and the ELF public naming doctrine: session-ingest, JWKS smoke flows, cutover runbooks, and any runtime/auth services that claim ELF JWT verification. Remove or deprecate the duplicate in-repo package copy if it is no longer the source of truth.
  **Must NOT do**: Do not leave docs claiming `@ch5me/elf-auth-client` is canonical while runtime code still imports a divergent unscoped package. Do not leave public-facing `Kilo` token/key names in place.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: this is cross-repo consumer migration plus docs/runtime consistency work
  - Skills: [`software-design-principles`] — why needed: avoid half-migration and duplicate contract residue
  - Omitted: [`ch5-auth`] — why not needed: consumer alignment comes before app-level auth wiring

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [10,12,13] | Blocked By: [2]

  **References**:
  - Pattern: `../firefly-cloud/services/session-ingest/src/middleware/firefly-jwt-auth.ts` — current verifier consumer
  - Pattern: `../firefly-cloud/docs/firefly-cutover-runbook.md` — current package/JWKS cutover dependency claims
  - Pattern: `../firefly-cloud/AGENTS.md` — current federation claim surface
  - Pattern: `../firefly-cloud/packages/elf-auth-client/package.json` — duplicate package to retire or re-point

  **Acceptance Criteria**:
  - [ ] Firefly Cloud runtime consumers use the canonical package contract
  - [ ] Firefly Cloud docs no longer point at contradictory package names, payload semantics, or public-facing `Kilo` naming
  - [ ] There is a clear deprecation/removal story for the duplicate package variant

  **QA Scenarios**:
  ```
  Scenario: Firefly consumer verification smoke
    Tool: Bash
    Steps: Run tests or smoke checks for session-ingest and any auth verification path using the canonical package
    Expected: Firefly runtime consumers verify JWTs successfully with the unified contract
    Evidence: .sisyphus/evidence/task-8-firefly-consumer-alignment.txt

  Scenario: Documentation consistency audit
    Tool: Bash
    Steps: Search Firefly Cloud docs and code for stale package names/payload fields after alignment
    Expected: No stale contradictory references remain in tracked authoritative docs/code
    Evidence: .sisyphus/evidence/task-8-firefly-consumer-alignment-error.txt
  ```

  **Commit**: YES | Message: `docs(auth): align firefly consumers to canonical elf auth package` | Files: `firefly-cloud`, docs/tests

- [x] 10. Implement Worker auth/session APIs with mocked ELF boundary

  **What to do**: Add Worker-side session endpoints and middleware shaped around the future ELF client contract, including auth verification adapter boundary, session bootstrap route(s), route guards, and test doubles/fakes for local and preview environments before live ELF dependencies exist.
  **Must NOT do**: Do not inline ELF-specific network behavior throughout handlers. Do not require desktop/native transport yet.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: worker middleware and API behavior must be production-shaped but platform-independent
  - Skills: [`auth-session-contract`, `cloudflare-workers-expert`] — why needed: session resolver doctrine plus Worker middleware correctness
  - Omitted: [`ch5-auth`] — why not needed: auth provider is ELF client, not a generic Better Auth setup

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [11,12,13] | Blocked By: [3,8]

  **References**:
  - Pattern: `packages/mcp/src/auth.ts` — current simplistic bearer gate should not become the hosted auth model
  - Pattern: `.ch5/services.yaml` — API worker contract and hostname surface
  - Pattern: auth-session-contract skill — required session behavior and conflict doctrine
  - External: librarian guidance on RS256/JWKS verification with cached JWKS in Worker runtime

  **Acceptance Criteria**:
  - [x] Worker auth middleware can validate mocked ELF-shaped sessions in local/preview modes
  - [x] Hosted API routes reject unauthenticated access while preserving local-only app behavior
  - [x] Session verification adapter is isolated behind a single boundary so live ELF client wiring is a swap, not a rewrite

  **QA Scenarios**:
  ```
  Scenario: Worker session bootstrap
    Tool: Bash
    Steps: Start local worker, hit session bootstrap and protected endpoints with mocked valid and invalid session inputs
    Expected: Valid mocked sessions authorize correctly; invalid or missing sessions return 401/403 as defined
    Evidence: .sisyphus/evidence/task-7-worker-auth.txt

  Scenario: Local-only mode remains usable
    Tool: Bash
    Steps: Run auth unit tests covering all resolution paths (cookie-only, bearer-only, protocol-token, identity-conflict, invalid-token, same-identity idempotent)
    Expected: 13/13 tests pass with 29 expect() calls covering all resolution paths
    Evidence: .sisyphus/evidence/task-7-worker-auth-error.txt
  ```

  **Commit**: YES | Message: `feat(api): add hosted session middleware and stubs` | Files: `api/`, tests

- [x] 11. Add hosted document CRUD and snapshot storage path

  **What to do**: Implement Worker-side hosted document CRUD, snapshot metadata handling, and R2-backed snapshot/asset storage paths that plug into the `DocumentBackend` abstraction. Support single-user hosted docs first; defer broad sharing UX and permissions.
  **Must NOT do**: Do not attempt broad multi-user sharing or full version-history product features in this task.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: integrates Worker, D1, R2, and app persistence seam
  - Skills: [`cloudflare-workers-expert`] — why needed: D1/R2 patterns and request handling need to be correct
  - Omitted: [`terraform-module-library`] — why not needed: this is runtime application logic, not infra modules

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [12,13] | Blocked By: [3,9]

  **References**:
  - Pattern: `src/app/document/io/write.ts` — current save/write semantics to preserve conceptually
  - Pattern: `src/app/document/io/read.ts` — current load/import flow to complement with hosted load
  - Pattern: `src/app/document/autosave/create.ts` — current autosave trigger behavior
  - Pattern: `.ch5/services.yaml` — D1 and R2 bucket declarations
  - External: librarian guidance on D1 metadata + R2 object split

  **Acceptance Criteria**:
  - [ ] Hosted save/load works through the app-side `DocumentBackend` contract
  - [ ] Snapshot and asset objects are stored using deterministic scoped keys
  - [ ] Hosted save failures do not corrupt local editor state and produce retryable errors

  **QA Scenarios**:
  ```
  Scenario: Save and reopen hosted document
    Tool: Playwright
    Steps: Create/edit a hosted document, save it, reload the app, and reopen the hosted document
    Expected: Same scene graph and metadata reload correctly from hosted storage
    Evidence: .sisyphus/evidence/task-8-hosted-storage.png

  Scenario: Hosted asset or snapshot failure
    Tool: Bash
    Steps: Simulate R2 failure during asset or snapshot write in integration tests
    Expected: Save operation fails safely with explicit error; document metadata is not left inconsistent
    Evidence: .sisyphus/evidence/task-8-hosted-storage-error.txt
  ```

  **Commit**: YES | Message: `feat(storage): add hosted document and snapshot persistence` | Files: `api/`, `src/app/document/`, tests

- [x] 12. Replace public-broker hosted collaboration path with Durable Object rooms

  **What to do**: Introduce a hosted collaboration transport that uses Cloudflare Durable Objects and WebSockets for document-bound rooms, while preserving current Trystero P2P mode for local-only collaboration until hosted mode is stable. Reuse current Yjs/awareness semantics where possible, but bind room identity and authorization to hosted document ownership rules.
  **Must NOT do**: Do not delete Trystero local collaboration in the same task. Do not expose unauthenticated hosted rooms.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: collaboration transport swap touches room identity, auth, Yjs sync, and mode boundaries
  - Skills: [`cloudflare-workers-expert`] — why needed: Durable Objects, WebSockets, and hibernation patterns are core here
  - Omitted: [`ch5-auth`] — why not needed: auth contract is already defined by ELF seam work

  **Parallelization**: Can Parallel: YES | Wave 5 | Blocks: [13] | Blocked By: [4,9]

  **References**:
  - Pattern: `src/app/collab/use.ts` — current collaboration entrypoint
  - Pattern: `src/app/collab/session.ts` — current collab lifecycle
  - Pattern: `src/app/collab/room.ts` — Trystero room join and signaling to preserve only for local mode
  - Pattern: `src/app/collab/yjs-sync.ts` — current graph↔Yjs sync logic to preserve through transport replacement
  - Pattern: `src/app/collab/awareness.ts` — cursor/presence/follow semantics that hosted mode must retain
  - Pattern: `.ch5/services.yaml` — declared `DocumentRoomDO`

  **Acceptance Criteria**:
  - [ ] Hosted collaboration joins authorized document-bound rooms via Durable Object transport
  - [ ] Local-only collaboration can still run through the legacy P2P mode until explicitly retired
  - [ ] Presence, cursor, and Yjs updates converge correctly across multiple hosted clients

  **QA Scenarios**:
  ```
  Scenario: Hosted room multi-client sync
    Tool: Playwright
    Steps: Open the same hosted document in two browser contexts, perform edits and cursor movements in both
    Expected: Edits, awareness, and follow-mode signals propagate correctly through the hosted room
    Evidence: .sisyphus/evidence/task-9-hosted-collab.png

  Scenario: Unauthorized room join rejection
    Tool: Bash
    Steps: Attempt WebSocket/room join with missing or invalid session for a hosted doc
    Expected: Durable Object/Worker rejects the join and no Yjs sync begins
    Evidence: .sisyphus/evidence/task-9-hosted-collab-error.txt
  ```

  **Commit**: YES | Message: `feat(collab): add hosted durable-object room transport` | Files: `api/`, `src/app/collab/`, tests

- [x] 13. Add hosted collaboration persistence, reconnect, and asset hydration rules

  **What to do**: Define and implement how hosted collaboration state persists between sessions: Yjs update persistence, room resume/reconnect behavior, snapshot compaction triggers, asset hydration rules for hosted docs, and explicit failure behavior for expired sessions or missing assets.
  **Must NOT do**: Do not build full offline cross-device sync or complete history UI in this phase.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: this is where collab durability and data integrity either hold or fail
  - Skills: [`cloudflare-workers-expert`] — why needed: Durable Object persistence and storage coordination matter here
  - Omitted: [`software-design-principles`] — why not needed: main architectural seam is already established; this is runtime durability logic

  **Parallelization**: Can Parallel: YES | Wave 5 | Blocks: [13] | Blocked By: [5,6,9]

  **References**:
  - Pattern: `src/app/collab/yjs-sync.ts` — current Yjs state flow
  - Pattern: `src/app/collab/local-awareness.ts` — local awareness payload shape to preserve
  - Pattern: `src/app/editor/canvas/collaboration-awareness.ts` — canvas integration surface
  - Pattern: `src/app/document/autosave/create.ts` — current save cadence concepts useful for snapshot timing
  - External: librarian guidance on DO SQLite + R2 snapshot vacuuming, asset cache/hydration rules

  **Acceptance Criteria**:
  - [ ] Hosted room reconnect restores document state without full document corruption or duplicate replay
  - [ ] Snapshot compaction and asset hydration rules are explicit and tested
  - [ ] Expired session and missing asset flows fail gracefully with actionable states

  **QA Scenarios**:
  ```
  Scenario: Reconnect after interruption
    Tool: Playwright
    Steps: Join hosted room, edit document, interrupt network/session briefly, then reconnect
    Expected: Document state converges correctly with no lost or duplicated updates
    Evidence: .sisyphus/evidence/task-10-collab-durability.png

  Scenario: Missing asset during hosted load
    Tool: Bash
    Steps: Simulate hosted document load referencing a missing asset object
    Expected: Document loads with explicit degraded-state error handling; process does not crash
    Evidence: .sisyphus/evidence/task-10-collab-durability-error.txt
  ```

  **Commit**: YES | Message: `feat(collab): persist hosted room state and reconnect flows` | Files: `api/`, collab persistence code, tests

- [ ] 14. Extend verification lanes, preview deploy flow, and hosted proof commands

  **What to do**: Extend the repo’s existing proof lanes with hosted/API-specific checks: Worker tests, hosted document CRUD tests, hosted collaboration e2e, preview deploy validation, and environment-aware smoke checks. Add API deployment workflow(s) aligned with current Pages preview/staging/prod behavior.
  **Must NOT do**: Do not rely on manual visual-only verification or ad hoc local-only commands.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: verification spans CI, deploy, Worker, and browser proof lanes
  - Skills: [`cloudflare-workers-expert`] — why needed: Worker preview/deploy/test behavior must align with platform runtime
  - Omitted: [`terraform-module-library`] — why not needed: CI/workflow alignment is the real focus

  **Parallelization**: Can Parallel: YES | Wave 6 | Blocks: [14] | Blocked By: [4,10]

  **References**:
  - Pattern: `package.json` — existing `check`, `test`, `test:unit`, `test:figma`, `build:packages`
  - Pattern: `.github/workflows/ci.yml` — current PR verification baseline
  - Pattern: `.github/workflows/app.yml` — current Pages deploy baseline
  - Pattern: `.github/workflows/preview.yml` — current preview deploy baseline
  - Pattern: `playwright.config.ts` — current E2E project setup

  **Acceptance Criteria**:
  - [ ] Hosted/API proof commands exist and are integrated into CI or explicit proof lanes
  - [ ] Preview deployments can validate hosted auth/document/collab behavior in an environment resembling staging
  - [ ] Existing local-first proof lanes remain intact and continue to run meaningfully

  **QA Scenarios**:
  ```
  Scenario: Run hosted proof lane
    Tool: Bash
    Steps: Execute the hosted/API proof command set in CI-equivalent mode
    Expected: Worker, hosted storage, and hosted collab checks run and pass with stable outputs
    Evidence: .sisyphus/evidence/task-11-proof-lanes.txt

  Scenario: Preview deployment verification
    Tool: Playwright
    Steps: Open preview deployment URL, exercise hosted-auth-gated surface and hosted document load/collab checks
    Expected: Preview build is routable and behaves consistently with staged runtime expectations
    Evidence: .sisyphus/evidence/task-11-proof-lanes-error.png
  ```

  **Commit**: YES | Message: `ci(hosted): add hosted proof and deploy lanes` | Files: workflows, proof scripts, tests

- [ ] 15. Add deferred desktop readiness seams without enabling desktop hosted auth yet

  **What to do**: Prepare the Tauri surface for later hosted auth handoff by isolating desktop transport hooks, callback/deep-link insertion points, secure token storage boundary, and hosted-document mode detection — but keep the feature disabled until web/API hosted flows are proven and approved.
  **Must NOT do**: Do not implement full desktop sign-in or bearer session flow in this phase. Do not make desktop dependent on hosted mode.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: narrow seam-prep work after major web/API decisions are stable
  - Skills: [`auth-session-contract`] — why needed: future bearer/native fallback must stay aligned with the web session contract
  - Omitted: [`ch5-auth`] — why not needed: this is readiness scaffolding, not provider implementation

  **Parallelization**: Can Parallel: YES | Wave 7 | Blocks: [F1,F2,F3,F4] | Blocked By: [7,10,11,12,13]

  **References**:
  - Pattern: `src/app/tauri/env.ts` — desktop/runtime detection seam
  - Pattern: `desktop/tauri.conf.json` — Tauri config and file association surface
  - Pattern: `src/views/EditorView.vue` — current app bootstrap point for Tauri-specific behavior
  - Pattern: `src/app/shell/menu/` and file-open flows — desktop file handling that must coexist with later hosted mode
  - External: auth-session-contract guidance on bearer/native fallback

  **Acceptance Criteria**:
  - [ ] Desktop-specific hosted auth/callback hooks are isolated behind disabled seams
  - [ ] Current desktop local-file experience remains unchanged
  - [ ] The future bearer/native integration path is documented and code-located without ambiguity

  **QA Scenarios**:
  ```
  Scenario: Desktop local-file regression check
    Tool: Bash
    Steps: Run Tauri dev/build smoke lane and exercise existing local open/save paths
    Expected: Desktop local-file workflows remain unchanged with hosted seams disabled
    Evidence: .sisyphus/evidence/task-12-desktop-readiness.txt

  Scenario: Disabled hosted desktop seam check
    Tool: Bash
    Steps: Validate that no desktop hosted auth callback path is active when feature gates are off
    Expected: Desktop does not attempt hosted auth or bearer flow prematurely
    Evidence: .sisyphus/evidence/task-12-desktop-readiness-error.txt
  ```

  **Commit**: YES | Message: `chore(tauri): prepare deferred hosted auth seams` | Files: `desktop/`, `src/app/tauri/`, tests/docs

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Keep hosted-readiness work in coherent conventional commits by seam: runtime scaffold, auth contract, hosted storage, collaboration, verification
- Avoid mixing desktop deferred work into web/API hosted commits
- Preserve local-first behavior in every intermediate commit

## Success Criteria
- OpenPencil can remain local-first while gaining a clearly staged path to ELF-hosted operation
- The implementer has zero ambiguity about contracts, file targets, rollout order, and proof requirements
- Hosted auth, document storage, and collaboration can land incrementally without rewriting editor core architecture
