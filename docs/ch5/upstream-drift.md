# Upstream drift ledger

This ledger records CH5 intent that edits or replaces upstream-owned behavior.
Resolve future conflicts by preserving the intent, not by blindly choosing
either side's diff.

## Current status

`PROGRAM`: the historical ledger is incomplete. Measured 2026-09-11 against
merge-base `51ab2157`, the fork has 905 fork-only commits: 582 substantive,
192 agent checkpoints, 100 merges, and 31 generated, fixture, or hygiene
commits. (A prior pass reported 725/413/191/90/31 against the older `ec31ea1`
ancestor; that range is superseded, not contradicted.) Treat the repository as
a hard fork until the one-time reconciliation reconstructs this ledger and
restores a small maintained delta.
`docs/ch5/upstream-capabilities.md` is the replay inventory.

## Known CH5 intent

| Area                                    | Why CH5 carries it                                                                                       | Invalidation signal                                                                    | Re-application rule                                                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ELF hosted auth                         | Protect `design.elf.dance` with ELF RS256/JWKS auth                                                      | Upstream introduces a compatible hosted auth boundary                                  | Keep auth at additive API/router seams; avoid editor-core changes                                                                                                                                         |
| Hosted API and storage                  | Persist hosted documents, assets, rooms, and user state                                                  | Upstream ships an equivalent backend contract                                          | Prefer adapters around upstream document/session APIs                                                                                                                                                     |
| Storage provider registry and selection | Reuse upstream local-first workspace while selecting ELF storage automatically in hosted-docs mode       | Upstream adds a credential-free runtime provider or first-class hosted adapter seam    | Keep `hosted-elf` registration and hosted-mode selection narrow; preserve S3 selection in local mode; run hosted adapter and registry regressions                                                         |
| Hosted document route bootstrap         | Deep links at `/hosted/:documentId` must open the matching ELF document through upstream tabs/storage    | Upstream router can bind a storage document directly                                   | Keep route bootstrap at app-shell/tab seams; do not fork document IO; run hosted route regression                                                                                                         |
| Hosted title persistence                | Upstream storage sync sends current document names, so ELF snapshots must update hosted metadata         | Upstream hosted backend accepts metadata on snapshot writes                            | Keep optional title on snapshot PUT and its CRUD regression                                                                                                                                               |
| CH5 deployment                          | Stage and promote through Forgejo, Hush, and Cloudflare                                                  | Upstream deployment becomes compatible with CH5 authority                              | Keep `.forgejo`, `.ch5`, `scripts`, and `docs/ch5` additive                                                                                                                                               |
| Hosted types and flags                  | Gate hosted agent chat independently from ELF auth, documents, and collaboration with `hostedAgent`      | Upstream adds a generic, independently configurable remote-agent capability            | Preserve `hostedAgent` in the shared hosted contract and app flag resolver; validate required API/gateway topology without making auth imply agent chat                                                   |
| Hosted chat transport selector          | Route hosted chat to the gateway before upstream BYOK model or local ACP selection                       | Upstream provides an equivalent authority-selected remote transport                    | Keep selection at the app chat seam; fail closed on missing config or transport errors and never fall back to BYOK or ACP                                                                                 |
| `ToolDef` schema and adapters           | Reuse canonical design actions for hosted manifests and guarded client-side execution                    | Upstream exposes equivalent remote policy, JSON Schema projection, and execution hooks | Keep explicit remote exposure/approval policy default-off; validate calls and execute through the app wrapper so targeting, undo, render, logs, and limits remain authoritative                           |
| ACP/product permission abstraction      | Give ACP process requests and hosted action approvals one fail-closed UI queue without conflating policy | Upstream adds a transport-neutral product permission service                           | Preserve the shared request/response abstraction and default rejection; keep ACP and hosted inputs adapted at their transport boundaries                                                                  |
| Provider-neutral agent protocol/adapter | Stream hosted runs through an authenticated service without exposing its infrastructure                  | Upstream adds an equivalent remote agent protocol and API adapter seam                 | Keep generic request/event/continuation schemas and one API adapter; preserve typed errors, opaque IDs, cancellation, resume, approvals, tool continuation, deterministic local fixtures, and no fallback |
| API index and gateway configuration     | Register hosted run/continue/cancel/resume routes and gateway binding at the hosted API boundary         | Upstream gains an equivalent configurable gateway router seam                          | Keep route registration and generic gateway origin/config narrow; ELF authenticates admission only; reject runtime, model, provider, billing, worker, container, image, and registry fields               |
| Targeted lint execution                 | CH5 review receipts must prove the exact requested rule/node mappings rather than whole-document lint    | Upstream linter gains equivalent targeted execution                                    | Keep `lintChecks` as the one core seam; reject missing nodes/rules; run focused lint regressions                                                                                                          |
| CLI bootstrap provenance                | Review receipts bind the exact CLI and production dependency bytes used during execution                 | Upstream CLI exposes equivalent provenance hooks                                       | Capture before command imports, verify after lint, keep normal CLI output unchanged, and run provenance regressions                                                                                       |
| Image-extension package seams           | Firefly/ELF needs PSD, raster composition, image resilience, and atomic image persistence APIs           | Upstream exposes equivalent public extension APIs                                      | Keep implementation additive; expose only explicit core subpaths; never restore parallel tabs, document storage, history, or renderer authorities                                                         |

### Exact hosted-agent upstream edits

Every upstream-owned source edit must be named by path and symbol with focused
proof. Additive CH5 modules do not require a drift row.

| Path and symbols                                                                                                                                                                                    | CH5 intent                                                                 | Invalidation signal                                      | Re-application rule                                                                          | Focused proof                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/tools/schema.ts` — `ToolRemotePolicy`, `ToolDef.remote`, `defineTool()`                                                                                                          | Default-off remote action policy                                           | Upstream adds equivalent transport policy                | Preserve explicit opt-in and approval metadata                                               | `tests/engine/tools/gateway-manifest.test.ts`                                                                                                                                                                  |
| `packages/core/src/tools/index.ts` — gateway manifest exports; `packages/core/src/tools/gateway-manifest.ts` — `createGatewayManifest()`                                                            | Publish one deterministic remote manifest adapter                          | Upstream reorganizes tool exports or action metadata     | Retain only public manifest exports and bounded compatibility policies                       | `tests/engine/tools/gateway-manifest.test.ts`                                                                                                                                                                  |
| `src/app/ai/chat/transports.ts` — `ensureChat()`                                                                                                                                                    | Select hosted transport before BYOK/ACP                                    | Upstream changes transport/model selection               | Keep `isHostedAgentEnabled()` first and never fall back                                      | `tests/engine/app/ai/agent-service-transport.test.ts`; `tests/e2e/hosted/hosted-agent-ui.spec.ts`                                                                                                              |
| `src/app/ai/tools/index.ts` — `createAITools(store, definitions)`                                                                                                                                   | Execute a manifest-filtered subset through the canonical wrapper           | Upstream changes wrapper construction                    | Preserve definition injection without duplicating execution behavior                         | `tests/engine/app/ai/gateway-execution.test.ts`                                                                                                                                                                |
| `src/app/ai/acp/permission.ts` — permission queue and session rejection helpers                                                                                                                     | Share one fail-closed product approval queue                               | Upstream replaces ACP permission state                   | Adapt both transports to one queue; never use an allow option as rejection fallback          | `tests/engine/acp/permission.test.ts`; gateway execution tests                                                                                                                                                 |
| `src/components/ChatPanel.vue` — hosted setup, terminal state, tab stop; `src/components/chat/ChatInput.vue` — hosted controls; `src/components/chat/ACPPermissionDialog.vue` — hosted cancellation | Keep hosted UI independent from provider controls and stop hidden-tab work | Upstream refactors chat orchestration                    | Preserve explicit failure, run-scoped stop, and normal BYOK/ACP controls outside hosted mode | `tests/e2e/hosted/hosted-agent-ui.spec.ts`; opt-in gateway E2E                                                                                                                                                 |
| `src/app/browser-bridge.ts` — `forceHostedAgent`                                                                                                                                                    | Deterministic hosted UI proof without changing deployment topology         | Upstream changes browser test hooks                      | Retain as test-only override, never production authority                                     | Hosted UI and gateway E2E                                                                                                                                                                                      |
| `src/app/automation/bridge/figma-factory.ts` — `makeFigmaFromStore()` guards                                                                                                                        | Run guarded wrapper tests without browser viewport globals                 | Upstream changes automation bridge construction          | Retain explicit runtime guards only for headless execution                                   | `tests/engine/app/ai/gateway-execution.test.ts`                                                                                                                                                                |
| `api/src/index.ts` — agent route registration; `api/wrangler.jsonc` — gateway bindings                                                                                                              | Bind the generic gateway at the authenticated API boundary                 | Upstream changes API routing or deployment configuration | Preserve ELF admission, generic origin/token binding, and no credential forwarding           | `api/src/agent/index.test.ts` (route mount, ELF admission, principal/credential isolation, streaming, continuation/cancel/resume); `api/src/agent/gateway.test.ts` (gateway configuration and stream contract) |

## Reconciliation done bar

- Every surviving upstream-file edit has a ledger row.
- Duplicate CH5/upstream features are collapsed to one implementation.
- `bun run upstream:inspect` reports `routine` or `review`, not `program`.
- Full configured verification passes before the merge commit lands.

## Baseline 2026-09-11 (owner: OpenPencil Upstream, thr_wjjkj9uq2c)

Read-only inspection. No merge, replay, or landing performed.

| Ref | SHA | Date |
| --- | --- | --- |
| `upstream/master` | `9d4fe4e421ac2be301a3d76a0c7d7883350656a8` | 2026-09-10 |
| `origin/main` | `ebed6410f2d56d1506bc788c7770ff673b40aaf2` | 2026-08-28 |
| merge-base | `51ab21571ad29cf86e4862e145dcf9e937860390` | 2026-08-11 |

`classification: program`, `canAutomate: false`. All three thresholds exceeded:
412 upstream commits (max 75), 2497 changed files (max 400), 156 conflicts (max 0).
Artifact: `~/.local/state/ch5/open-pencil-upstream/inspect-20260911T202227Z.json`.

### Scope reconciliation

`2497` is the upstream-side file count (merge-base to `upstream/master`); `703` is the
private-side count (merge-base to `origin/main`). Union 2945. The integration-cost
number is neither: **255 files are touched by both sides**, and 156 of those conflict.
The collision surface is 8.7% of the union, not a whole-tree rewrite.

### Private delta composition (905 commits)

| Kind | Count | Disposition |
| --- | --- | --- |
| Substantive | 582 | classify per capability |
| `omx` agent auto-checkpoints | 192 | drop (process noise, folded into tip) |
| Merge commits | 100 | drop |
| Hygiene/generated (keyword lower bound) | 31 | regenerate |

Two clusters are conflict fuel carrying no product intent and must be **regenerated,
never merged**: the 230-file CH5 `oxfmt` reformat sweep (upstream independently
reformatted in `ec0aacd4f`, 2026-09-10), and committed binary `.tgz` K1 proof
artifacts under `artifacts/`.

### Verification state at `ebed6410` — NOT GREEN

`bun run format:verify` exits 1 on pristine HEAD; 7 files are unformatted under the
repo's own pinned `oxfmt 0.60.0`:

```
packages/core/src/constants.ts                              (collides with upstream)
packages/scene-graph/src/index.ts                           (collides with upstream)
tests/engine/scene-graph/history/undo-manager-compat.test.ts
tests/engine/scene-graph/id-allocation.test.ts
tests/engine/scene-graph/variables-compat.test.ts
tools/agent-gateway/src/executor.ts
tools/agent-gateway/src/gateway.ts
```

The pin landed `99770b532` (2026-08-12); all 7 files landed 2026-08-18, after it.
`.forgejo/*` runs `format:check`, which fails identically — the gate was not enforced.
`bun run check` did not complete under a bounded run; its status is UNKNOWN.

**Consequence:** the skill requires full configured verification green before a merge
lands. That precondition is unmet today, independent of upstream. Any merge started
now would inherit a red baseline and failures could not be attributed to upstream.

### Upstream convergence: none

All 412 pending upstream commits were searched for hosted auth, storage provider,
remote-agent transport, and gateway equivalents. No match. No CH5 hosted-mode
capability row has an invalidation signal firing in this range; that delta is
load-bearing, not redundant.

### Confirmed seam collisions

- `be942783d` deletes the monolithic i18n dialog catalogs; its diff also modifies
  `src/components/chat/ACPPermissionDialog.vue`, a ledger-named CH5 seam file.
- `b4e479d9d` (chat history persistence) touches `src/app/ai/chat/transports.ts`,
  `src/components/ChatPanel.vue`, `src/components/chat/ChatInput.vue` — all
  ledger-named. This is the "upstream refactors chat orchestration" invalidation
  signal firing.
- `AppTextButton.vue` is deleted upstream (`5f8a373b2`) but imported by 5 CH5 files
  including `ChatPanel.vue` → preserve or re-point. `AppComboboxInput.vue` is deleted
  upstream (`f674f8c99`, Reka UI replacement) and self-referenced only in CH5 → drop
  candidate. Same conflict class, opposite dispositions: do not batch-resolve.

### Contract gaps

- The helper emits boolean `canAutomate`; the current skill's Schedule section reads
  `automation.scheduledLandingAllowed` and distinguishes `review-required` from
  `reconciliation-required`. Fail-closed today, so safe, but non-conforming.
- A local `v0.14.1` tag exists that is **not** an upstream release; it is fork-authored
  and collides with upstream's version namespace. Do not cite it as upstream.
- No `ch5-sched` job is registered. Correct while `program`, but nothing observes drift.

## Reconciliation plan: root-config bucket (2026-09-11, read-only)

Owner `thr_wjjkj9uq2c`. No mutation to shared `main`, no merge, no replay started.

### The 98 unclassified commits resolve to 28 files

The `other-only` bucket (98 non-merge commits touching neither CH5-additive nor
upstream-owned trees) spans 162 distinct files. **134 are already deleted at
`origin/main`** — agent scratch (`.sisyphus`, `.omo`, `.playwright-mcp`,
`openwiki`), image-editor authority probe receipts, and K1 tarballs, all shed
during earlier cleanup. They need no replay action; the tip already reflects the
decision.

28 files survive. Of those, **11 also change upstream** and are the only members
of this bucket carrying merge risk:

```
.gitignore  AGENTS.md  CHANGELOG.md  README.md  bun.lock  knip.json
lint/plugin.js  oxlint.json  package.json  playwright.config.ts  vite.config.ts
```

Disposition: `package.json`/`bun.lock` reconcile by intent (CH5 pins
`oxfmt 0.60.0`/`oxlint 1.75.0`, upstream `^0.67.0`/`1.57.0`); narrative docs
(`AGENTS.md`, `README.md`, `CHANGELOG.md`) take upstream and re-apply CH5
sections; tool configs merge additively. The remaining 17 surviving files are
CH5-only and carry no upstream conflict.

Conclusion: this bucket is a **history artifact, not a content problem**. It does
not require per-commit classification.

### BLOCKER: replay seed gap deletes CH5 capability code

`replay.additivePaths` seeds `tools/ch5` only. **31 CH5-only files outside
upstream-owned trees are unseeded** and would be deleted by
`replay-start`, which replaces the candidate tree with exact upstream and
restores only seeded paths:

```
tools/agent-gateway/    9 files   ledgered capability (hosted agent gateway)
tools/deployment/       5 files   build-candidate, promote, workflow
tools/hosted-proof/     4 files   hosted + preview proof
tools/local-bootstrap/  4 files
tools/hosted/           2 files   validate-flags
scripts/visual-{bisect,compare}.ts, scripts/export-fixture-visuals.ts
.ch5rc  .cloud-work/config.json  CLAUDE.md
artifacts/h0-scene-graph-public-contract-receipt.json   (regenerate, do not seed)
```

Proven failure mode — 5 of 6 seeded shims import unseeded implementations:

| Seeded shim | Imports | Status |
| --- | --- | --- |
| `scripts/build-candidate.mjs` | `tools/deployment/src/build-candidate.mjs` | UNSEEDED |
| `scripts/promote.mjs` | `tools/deployment/src/promote.mjs` | UNSEEDED |
| `scripts/hosted-proof.ts` | `tools/hosted-proof/src/hosted` | UNSEEDED |
| `scripts/preview-proof.ts` | `tools/hosted-proof/src/preview` | UNSEEDED |
| `scripts/validate-hosted-flags.ts` | `tools/hosted/src/validate-flags` | UNSEEDED |
| `scripts/upstream-sync.ts` | `tools/ch5/src/upstream-sync` | seeded (only correct pair) |

A replay run today restores 5 shims and deletes every module they import.
`tools/agent-gateway` is deleted with no shim at all.

Files under `packages/`, `src/`, `tests/`, `desktop/` are correctly unseeded —
the skill forbids seeding edits to upstream-owned source; those port one
capability at a time.

### Acceptance criteria (all must hold before `replay-start`)

1. `replay.additivePaths` covers all 31 files above; re-running the gap check
   yields **0** unseeded CH5-only files outside upstream-owned trees.
2. Every seeded shim resolves to a seeded implementation (shim table all-seeded,
   `scripts/upstream-sync.ts` unchanged).
3. `artifacts/**` is excluded from seeding and regenerated; no `.tgz` is seeded.
4. `bun test tests/engine/upstream-sync/` green.
5. `bun scripts/upstream-sync.ts inspect` still reports `program`, `criticalFiles`
   = 107, classification unchanged by the seed edit.
6. Replay runs in a dedicated Grove Tree with `--allow-program
   --confirm-upstream-first`; `finish` without `--push`.
7. Final commit is a merge: parent one private `main`, parent two exact
   `9d4fe4e421ac2be301a3d76a0c7d7883350656a8`.

### Chris-only gate: format repair

`format:verify` and `format:check` both fail at `ebed6410` on 7 files
(`packages/core/src/constants.ts`, `packages/scene-graph/src/index.ts`, three
`tests/engine/scene-graph/*` files, `tools/agent-gateway/src/{executor,gateway}.ts`).
Two collide with upstream.

**This owner will not touch those files or push to shared `main` without an
explicit Chris gate.** They are other-owned, and the fix lands on shared history.
Configured verification green is a precondition the skill requires before any
upstream landing, so this gate blocks the whole sequence. Repair is mechanical
(`bun run format`) but is Chris's call, not this owner's.
