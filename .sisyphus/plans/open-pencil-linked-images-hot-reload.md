# OpenPencil Linked Images Hot Reload

## TL;DR

> **Quick Summary**: Add a linked-image resolution layer above OpenPencil’s existing `fill.imageHash -> graph.images` renderer contract so external image sources can resolve into stable byte slots, hot-reload cleanly, and still export/save as normal embedded `.fig` snapshots.
>
> **Deliverables**:
>
> - Linked-image registry + source resolution pipeline for URL and local-file sources
> - Targeted renderer image invalidation + repaint path
> - Minimal product UI for linking, refreshing, and reporting source state
> - Local hot-reload/watch loop for linked assets
> - Proof board containing three linked images that update after source changes
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 3 waves + final verification
> **Critical Path**: registry contract → resolver/update path → renderer invalidation → watcher/UI integration → proof flow

---

## Context

### Original Request

Build a spike that lets OpenPencil display linked images from arbitrary fetchable sources (local disk, local web server, hosted URLs), hot-reload them when sources change, and prove the workflow with three linked images while keeping the renderer and existing byte-based image pipeline sane.

### Interview Summary

**Key Discussions**:

- Preserve the renderer contract: it should only consume stable byte-backed image keys, not URLs.
- Add a higher-layer source-resolution system that fetches/reloads bytes and feeds the existing image pipeline.
- Use OpenPencil not just as a design tool, but as a dev screenshot/review board.
- Keep source changes minimal and product-shaped rather than rebuilding the image/fill model.

**Research Findings**:

- `Fill` currently models image usage only through `imageHash`, `imageScaleMode`, and `imageTransform`.
- `graph.images` is the canonical in-memory image byte store and `.fig` export snapshots all current entries.
- Renderer uses `graph.images.get(hash)` and caches decoded images.
- Existing editor file-watch plumbing can support local hot-reload behavior.
- Plugin data round-trips through Kiwi, but is a weaker first implementation surface than a sidecar/dev resolver.

### Metis Review

**Identified Gaps** (addressed):

- Persistence ambiguity resolved by planning a dev-side/source-resolution layer while keeping `.fig` save/export as embedded snapshot output.
- Cache invalidation made explicit as a first-class implementation task.
- Scope creep around auth, drag/drop URL ingestion, remote collaboration semantics, and full core-fill redesign is explicitly excluded from v1.
- Acceptance criteria now require broken-source UX, three-image proof, reload timing, and preservation of existing embedded image workflows.

---

## Work Objectives

### Core Objective

Implement a minimal but product-worthy linked-image system for OpenPencil that resolves external image sources into the existing byte-backed render path, supports live updates, and preserves the current `.fig` portability model.

### Concrete Deliverables

- Linked-image metadata/registry contract outside the core fill model
- Source resolver for `http/https` and local-file-backed images
- Stable linked-image key strategy compatible with `graph.images`
- Renderer invalidation hook for refreshed image bytes
- Watch/reload flow for local linked assets
- UI affordances for link, relink, refresh, and source-state display
- Proof board with three linked images and a scripted reload demonstration

### Definition of Done

- [ ] Linked images render through the existing image fill pipeline without teaching the renderer about URLs/paths
- [ ] Updating a watched local image reloads the board without reopening the document
- [ ] Three linked images can be placed on a board and verified visually after source updates
- [ ] Existing embedded-image workflows and `.fig` save/export continue to work

### Must Have

- Stable source-resolution layer above the renderer
- Explicit decoded-image cache invalidation
- Broken/stale source UX
- Embedded snapshot behavior on save/export
- Verification via unit tests + agent-executed QA scenarios

### Must NOT Have (Guardrails)

- No first-class URL/path fields added directly to the core `Fill` render contract in v1
- No renderer fetch logic or path parsing inside `applyImageFill`
- No broad image asset system redesign, CDN cache, or optimization pipeline
- No auth-heavy/private-source feature set in v1 beyond clearly documented limitations
- No regression to existing file-picker embedded image flow

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES
- **Automated tests**: Tests-after
- **Framework**: `bun test` for engine/unit tests; existing repo checks via `bun run check` where environment permits
- **Target suites**:
  - `bun test ./tests/engine`
  - focused tests for linked image registry/resolver/cache invalidation/watch flows

### QA Policy

Every task must include unit/integration verification plus agent-executed QA scenarios.
Evidence saved under `.sisyphus/evidence/open-pencil-linked-images/`.

- **Frontend/UI**: Playwright or browser automation against local OpenPencil app
- **File/watch behavior**: Bash/Tauri-aware command flow with controlled file mutations
- **CLI/proof generation**: Bash against `open-pencil` scripts/commands
- **Library/module**: `bun test` and focused import/invocation checks

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — contracts and non-UI foundations):
├── Task 1: PM/product contract + scope guardrails [writing]
├── Task 2: Linked image registry/domain contract [deep]
├── Task 3: Renderer invalidation contract [quick]
├── Task 4: Source resolver + fetch policy design [deep]
└── Task 5: Test harness + fixtures for linked images [quick]

Wave 2 (After Wave 1 — implementation building blocks):
├── Task 6: Registry/store integration in editor state [unspecified-high]
├── Task 7: Resolver execution + byte replacement path [deep]
├── Task 8: Local watch / reload orchestration [unspecified-high]
├── Task 9: UI touchpoints for linking and status [visual-engineering]
└── Task 10: Collab/save/export compatibility hardening [deep]

Wave 3 (After Wave 2 — proof and polish):
├── Task 11: Three-linked-image proof board workflow [quick]
├── Task 12: Error/stale-state polish + retry behavior [visual-engineering]
└── Task 13: Docs / operator workflow for screenshot-board usage [writing]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real QA execution of linked-image scenarios (unspecified-high)
└── Task F4: Scope fidelity + regression check (deep)
```

### Dependency Matrix

- **1**: — — 9, 13, 1
- **2**: — — 6, 7, 8, 10, 2
- **3**: — — 7, 8, 12, 2
- **4**: — — 7, 8, 10, 2
- **5**: — — 7, 8, 9, 10, 11, 2
- **6**: 2 — 8, 9, 10, 11, 3
- **7**: 2, 3, 4, 5 — 8, 10, 11, 12, 3
- **8**: 2, 3, 4, 5, 6, 7 — 11, 12, 3
- **9**: 1, 5, 6 — 11, 12, 13, 3
- **10**: 2, 4, 5, 6, 7 — 11, 13, 3
- **11**: 5, 6, 7, 8, 9, 10 — F1-F4, FINAL
- **12**: 3, 7, 8, 9 — F1-F4, FINAL
- **13**: 1, 9, 10 — F1-F4, FINAL

### Agent Dispatch Summary

- **1**: **5** — T1 → `writing`, T2 → `deep`, T3 → `quick`, T4 → `deep`, T5 → `quick`
- **2**: **5** — T6 → `unspecified-high`, T7 → `deep`, T8 → `unspecified-high`, T9 → `visual-engineering`, T10 → `deep`
- **3**: **3** — T11 → `quick`, T12 → `visual-engineering`, T13 → `writing`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Product contract for linked screenshot boards

  **What to do**:
  - Write the v1 product contract for linked images: goals, supported source types, non-goals, failure modes, and save/export semantics.
  - Define the exact user-facing mental model: “linked source resolves to bytes; saved `.fig` is a snapshot.”
  - Lock PM-level touchpoints: where linking lives in UI, what “refresh” means, and what state badges/errors are required.

  **Must NOT do**:
  - Do not broaden v1 into a full media asset management feature.
  - Do not promise authenticated/private-source support beyond explicit future work notes.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: this is product and operator contract writing, not code exploration.
  - **Skills**: [`pm-lens`]
    - `pm-lens`: helps keep the feature surface and cardinal user journeys tight.
  - **Skills Evaluated but Omitted**:
    - `api-design`: no public API contract is primary here.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-5)
  - **Blocks**: 9, 13
  - **Blocked By**: None

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/src/components/ImageFillPicker.vue` - current image-entry touchpoint to evolve
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/docs/reference/scene-graph.md` - current documented image model and constraints
  - `/Users/hassoncs/Workspaces/Personal/fitbot/.ai/progress.md` - prior research summary and product intent

  **Acceptance Criteria**:
  - [ ] Product contract explicitly states supported source classes: local file, local web URL, hosted URL
  - [ ] Save/export semantics are explicit: `.fig` saves embedded snapshot bytes
  - [ ] UI touchpoints and non-goals are documented and referenced by implementation tasks

  **QA Scenarios**:

  ```
  Scenario: Contract covers all core journeys
    Tool: Bash (read/grep)
    Preconditions: product contract doc/update exists in implementation branch
    Steps:
      1. Search for "local file", "hosted URL", "snapshot", and "broken source" in the contract
      2. Verify each term appears in a normative statement, not a TODO
      3. Save grep output as evidence
    Expected Result: all key workflow terms appear with clear behavioral expectations
    Failure Indicators: one or more core journeys are missing or ambiguous
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-1-contract-coverage.txt

  Scenario: Scope is constrained
    Tool: Bash (read/grep)
    Preconditions: contract exists
    Steps:
      1. Search for "non-goals" or equivalent guardrail section
      2. Verify auth-heavy/private-source and full asset-manager behavior are excluded
    Expected Result: v1 boundaries are explicit
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-1-scope-guardrails.txt
  ```

- [x] 2. Linked image registry and source contract

  **What to do**:
  - Define the minimal linked-image registry shape above the fill model.
  - Choose stable synthetic linked-image ids for render lookup keys.
  - Define how registry records map to `nodeId + fillIndex` or equivalent stable association.

  **Must NOT do**:
  - Do not add URL/path fields directly to the core fill render contract in v1.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: this is the core architectural seam protecting the renderer contract.
  - **Skills**: [`architecture-patterns`]
    - `architecture-patterns`: helps preserve boundary separation between source-resolution and rendering.
  - **Skills Evaluated but Omitted**:
    - `api-design`: useful later, but internal boundary design matters more first.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 6, 7, 8, 10
  - **Blocked By**: None

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/scene-graph/index.ts` - current `Fill` and `graph.images` contracts
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/editor/clipboard.ts` - existing content-hash image storage behavior
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/figma-api/proxy.ts` - pluginData access patterns if metadata fallback is needed

  **Acceptance Criteria**:
  - [ ] Registry format supports source URL/path, source type, status, and stable image key
  - [ ] Registry choice preserves current `fill.imageHash -> graph.images` renderer contract
  - [ ] ID strategy avoids coupling live reload identity to content hash churn

  **QA Scenarios**:

  ```
  Scenario: Registry contract supports stable hot-reload identity
    Tool: Bash (grep/read)
    Preconditions: registry type/module exists
    Steps:
      1. Read registry type definitions
      2. Verify they include stable linked image id plus source metadata
      3. Verify no direct `imageUrl`/`imagePath` field was added to core Fill for v1
    Expected Result: source metadata lives outside the core render fill contract
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-2-registry-contract.txt

  Scenario: Fill contract remains stable
    Tool: Bash (grep)
    Preconditions: code updated
    Steps:
      1. Search `scene-graph/index.ts` for Fill image fields
      2. Confirm only render-oriented image fields remain in Fill
    Expected Result: renderer-facing fill contract stays narrow
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-2-fill-contract.txt
  ```

- [x] 3. Renderer image invalidation hook

  **What to do**:
  - Add a targeted invalidation path for refreshed linked-image bytes.
  - Ensure decoded cached images are disposed safely and repaint is requested.
  - Document the hook so higher layers can call it after byte refresh.

  **Must NOT do**:
  - Do not force full renderer destroy/recreate for each linked image update.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: small, focused engine API addition with narrow blast radius.
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `architecture-patterns`: too heavyweight for this narrow change.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 7, 8, 12
  - **Blocked By**: None

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/canvas/fills.ts` - current hash→decoded-image lookup path
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/canvas/renderer.ts` - `imageCache` lifetime and cleanup behavior

  **Acceptance Criteria**:
  - [ ] A callable path exists to invalidate one image key without full renderer reset
  - [ ] Invalidating a linked image leads to fresh decode on next paint
  - [ ] No leaked stale decoded image object remains in cache after refresh

  **QA Scenarios**:

  ```
  Scenario: Single image cache entry is invalidated and repainted
    Tool: bun test
    Preconditions: targeted renderer/cache test exists
    Steps:
      1. Run the focused renderer cache test file
      2. Assert old decoded image is dropped and new bytes render on next frame
    Expected Result: test passes and proves targeted invalidation behavior
    Failure Indicators: stale image persists or cache is only cleared via renderer destroy
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-3-renderer-invalidation.txt

  Scenario: Existing image rendering still works
    Tool: bun test
    Preconditions: regression coverage exists for normal image fill rendering
    Steps:
      1. Run focused existing image render tests
      2. Confirm no regression for embedded image fills
    Expected Result: existing image tests remain green
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-3-embedded-regression.txt
  ```

- [x] 4. Source resolver and fetch policy

  **What to do**:
  - Implement the source-resolution layer for `http/https` and local-file-backed linked images.
  - Define retry, timeout, content-type/decode validation, debounce, and failure-state policy.
  - Ensure resolved bytes can be written into `graph.images` under stable linked ids.

  **Must NOT do**:
  - Do not put fetch/path logic inside renderer fill application.
  - Do not add a broad persistent asset cache in v1.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: platform differences, source validation, and failure semantics require careful handling.
  - **Skills**: [`bash-defensive-patterns`]
    - `bash-defensive-patterns`: useful mindset for timeout/retry/debounce/error handling discipline.
  - **Skills Evaluated but Omitted**:
    - `web-capture-routing`: unrelated to product-side image resolution internals.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 7, 8, 10
  - **Blocked By**: None

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/src/stores/editor.ts` - existing file-watch/reload infrastructure
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/canvas/fills.ts` - downstream expectation: bytes already available
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/src/components/ImageFillPicker.vue` - current local-file image ingestion entrypoint

  **Acceptance Criteria**:
  - [ ] Resolver supports `http/https` and local file source classes defined in product contract
  - [ ] Invalid/non-image responses fail gracefully with explicit state
  - [ ] Resolver outputs stable byte updates into `graph.images`

  **QA Scenarios**:

  ```
  Scenario: Hosted/local-web image resolves successfully
    Tool: bun test
    Preconditions: resolver tests with mocked fetch/local server fixture exist
    Steps:
      1. Run focused resolver tests
      2. Assert valid image response populates bytes and success state
    Expected Result: successful resolution into byte payloads
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-4-url-resolution.txt

  Scenario: Non-image or unreachable source fails cleanly
    Tool: bun test
    Preconditions: failure-path resolver tests exist
    Steps:
      1. Run focused resolver failure tests
      2. Assert broken status/error metadata is set without crash
    Expected Result: graceful error state, no renderer crash
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-4-broken-source.txt
  ```

- [x] 5. Test fixtures and verification harness for linked images

  **What to do**:
  - Add deterministic image fixtures and helper utilities for linked-image tests.
  - Add test scaffolding for byte replacement, watch-trigger simulation, and proof-board verification.
  - Ensure proof workflow can be validated without manual setup.

  **Must NOT do**:
  - Do not depend on flaky remote external services for deterministic tests.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: isolated test scaffolding work.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 7, 8, 9, 10, 11
  - **Blocked By**: None

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/tests/engine/image.test.ts` - existing image test patterns
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/tests/engine/render-cache.test.ts` - likely cache-oriented test precedent
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/package.json` - test commands and expected lanes

  **Acceptance Criteria**:
  - [ ] Fixtures exist for three image states and updated variants
  - [ ] Test helpers can simulate source refresh deterministically
  - [ ] Proof workflow can be exercised in automated verification

  **QA Scenarios**:

  ```
  Scenario: Test harness exercises linked image refresh
    Tool: bun test
    Preconditions: linked image fixture tests exist
    Steps:
      1. Run focused fixture/harness test file
      2. Assert pre-refresh and post-refresh image bytes differ as expected
    Expected Result: deterministic refresh simulation passes
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-5-fixture-harness.txt

  Scenario: Fixtures support proof-board generation
    Tool: Bash
    Preconditions: proof fixture assets exist in repo/test area
    Steps:
      1. List proof fixture files used by tests
      2. Verify exactly three primary linked image fixtures exist and are referenced by tests
    Expected Result: proof fixture set is complete
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-5-proof-fixtures.txt
  ```

- [x] 6. Editor-store integration for linked image registry

  **What to do**:
  - Add the editor/store-level registry for linked-image metadata and lifecycle.
  - Expose the minimum public store methods for link, relink, refresh, and status retrieval.
  - Keep the registry decoupled from the renderer and core fill contract.

  **Must NOT do**:
  - Do not leak URL/path semantics into `graph.images` consumers.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: store/API shaping across app/editor boundaries with moderate risk.
  - **Skills**: [`architecture-patterns`]
    - `architecture-patterns`: useful to preserve clean boundary placement.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: 8, 9, 10, 11
  - **Blocked By**: 2

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/src/stores/editor.ts` - central app/store surface
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/editor/create.ts` - existing editor-exposed image methods
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/editor/clipboard.ts` - current `storeImage` behavior to mirror/extend

  **Acceptance Criteria**:
  - [ ] Store exposes linked-image operations without changing renderer-facing contracts
  - [ ] Registry state can be queried by UI for status and source metadata
  - [ ] Existing embedded image operations remain intact

  **QA Scenarios**:

  ```
  Scenario: Store API supports link lifecycle
    Tool: bun test
    Preconditions: store-level linked image tests exist
    Steps:
      1. Run focused editor store test file
      2. Assert create/update/remove/status operations behave as expected
    Expected Result: linked image lifecycle is managed by the store cleanly
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-6-store-lifecycle.txt

  Scenario: Embedded image API remains functional
    Tool: bun test
    Preconditions: regression tests cover existing image storage methods
    Steps:
      1. Run existing embedded image store tests
      2. Confirm unchanged pass behavior
    Expected Result: no regression to standard image insertion flow
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-6-embedded-api.txt
  ```

- [x] 7. Resolver execution and byte replacement path

  **What to do**:
  - Connect the source resolver to the store registry.
  - On successful fetch/load, replace bytes in `graph.images` under the stable linked-image key.
  - Trigger renderer invalidation and repaint after each successful refresh.

  **Must NOT do**:
  - Do not mutate the scene model to chase changing content hashes on each update.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: this is the core runtime behavior of the feature.
  - **Skills**: [`architecture-patterns`]
    - `architecture-patterns`: protects the contract layering.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: 8, 10, 11, 12
  - **Blocked By**: 2, 3, 4, 5

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/canvas/fills.ts` - where refreshed bytes are ultimately consumed
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/canvas/renderer.ts` - image cache lifecycle
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/editor/clipboard.ts` - current `graph.images.set(hash, bytes)` pattern

  **Acceptance Criteria**:
  - [ ] Successful refresh overwrites bytes at stable linked-image key
  - [ ] Refresh triggers targeted invalidation + repaint
  - [ ] Scene nodes keep stable fill references across source updates

  **QA Scenarios**:

  ```
  Scenario: Linked image refresh updates rendered bytes without fill churn
    Tool: bun test
    Preconditions: resolver execution tests exist
    Steps:
      1. Run focused linked image execution test
      2. Assert image bytes change while the fill key remains stable
    Expected Result: scene references stay stable while rendered content updates
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-7-stable-refresh.txt

  Scenario: Repaint occurs after refresh
    Tool: bun test
    Preconditions: renderer/store integration test exists
    Steps:
      1. Trigger linked image refresh in test harness
      2. Assert repaint/invalidation path was invoked
    Expected Result: update is not stuck in memory only
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-7-repaint.txt
  ```

- [x] 8. Local watch and reload orchestration

  **What to do**:
  - Reuse/extend editor watch plumbing so local linked sources can hot-reload.
  - Add debounce/coalescing to avoid reload storms from repeated writes.
  - Support manual refresh triggers as a fallback for non-watchable sources.

  **Must NOT do**:
  - Do not assume every source is watchable.
  - Do not couple watch logic to a single document file path only.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: host/runtime-specific behavior with tricky reload timing.
  - **Skills**: [`bash-defensive-patterns`]
    - `bash-defensive-patterns`: useful mental model for debounce and idempotent reloads.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: 11, 12
  - **Blocked By**: 2, 3, 4, 5, 6, 7

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/src/stores/editor.ts` - current watch/reload flow for `.fig` files
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/canvas/renderer.ts` - repaint dependencies after source change

  **Acceptance Criteria**:
  - [ ] Local file modifications can trigger linked image refresh automatically
  - [ ] Debounce prevents repeated redundant reloads from bursty writes
  - [ ] Manual refresh exists for non-watch sources or browser-limited environments

  **QA Scenarios**:

  ```
  Scenario: Local file change triggers hot reload
    Tool: Bash + browser automation
    Preconditions: linked local image is attached to a board in a local OpenPencil session
    Steps:
      1. Start OpenPencil app with a board containing one watched local linked image
      2. Replace the underlying source file with a visibly different fixture image
      3. Wait up to 3 seconds for watcher/debounce window
      4. Assert the artboard preview updates to the new image
    Expected Result: hot reload occurs without reopening the document
    Failure Indicators: no visual change, stale image persists, or app errors
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-8-local-watch.txt

  Scenario: Burst writes do not cause reload storm
    Tool: bun test or Bash harness
    Preconditions: watch debounce test exists
    Steps:
      1. Trigger multiple rapid source writes inside debounce window
      2. Assert refresh executes once or within bounded expected count
    Expected Result: coalesced refresh behavior
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-8-debounce.txt
  ```

- [x] 9. Product UI for link, relink, refresh, and status

  **What to do**:
  - Extend the current image fill entrypoint with linked-image affordances.
  - Add explicit actions for link/relink/refresh/remove-link and visible state for loading/broken/stale.
  - Keep the standard embedded image picker path intact.

  **Must NOT do**:
  - Do not redesign the whole image fill experience.
  - Do not hide broken-source state behind silent failures.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: focused UI/UX integration work with state display.
  - **Skills**: [`ui-content-design`]
    - `ui-content-design`: useful for concise labels and error text.
  - **Skills Evaluated but Omitted**:
    - `impeccable`: broader UI polish is beyond the spike’s needs.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: 11, 12, 13
  - **Blocked By**: 1, 5, 6

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/src/components/ImageFillPicker.vue` - current image fill UI surface
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/src/stores/editor.ts` - linked-image store methods/status sources
  - Task 1 product contract - required UX states and supported flows

  **Acceptance Criteria**:
  - [ ] User can add a linked image from URL/path-oriented flow
  - [ ] User can manually refresh and relink an existing linked image
  - [ ] Loading/broken/stale status is visible in the UI
  - [ ] Embedded image workflow remains available and unchanged in spirit

  **QA Scenarios**:

  ```
  Scenario: Link image flow is visible and usable
    Tool: Playwright
    Preconditions: OpenPencil app running with a selectable node that supports image fills
    Steps:
      1. Open the image fill UI for a rectangle node
      2. Verify controls for linked image flow exist alongside embedded-image flow
      3. Enter a valid test URL/source and submit
      4. Assert preview/status updates from loading to ready
    Expected Result: linked image can be created from UI without removing normal image flow
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-9-link-ui.txt (screenshot description)

  Scenario: Broken source state is surfaced
    Tool: Playwright
    Preconditions: a linked image with an invalid URL/source is configured
    Steps:
      1. Open the image fill UI
      2. Assert a visible broken/error state appears
      3. Assert manual refresh/relink action is present
    Expected Result: the user can tell what failed and what to do next
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-9-broken-ui.txt (screenshot description)
  ```

- [x] 10. Save/export/collab compatibility hardening

  **What to do**:
  - Ensure linked images still save/export as embedded snapshot bytes.
  - Decide/document what metadata is persisted in v1 versus dev-only sidecar/runtime state.
  - Prevent regressions in collab byte-sync behavior for image keys.

  **Must NOT do**:
  - Do not require every peer to understand source URLs in v1.
  - Do not break `.fig` round-trip or existing image tests.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: this crosses serialization, runtime semantics, and regression boundaries.
  - **Skills**: [`architecture-patterns`]
    - `architecture-patterns`: useful for compatibility boundary reasoning.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: 11, 13
  - **Blocked By**: 2, 4, 5, 6, 7

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/io/formats/fig/export.ts` - embedded snapshot export path
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/kiwi/serialize.ts` - paint/image serialization path
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/kiwi/convert.ts` - import/round-trip semantics
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/src/composables/use-collab.ts` - current image byte syncing by key

  **Acceptance Criteria**:
  - [ ] Saving/exporting a document with linked images produces a working embedded snapshot
  - [ ] Existing `.fig` image import/export tests remain green or are updated with clear coverage
  - [ ] Collab continues to mirror bytes by stable image key without requiring URL awareness

  **QA Scenarios**:

  ```
  Scenario: Linked image board saves and reloads as embedded snapshot
    Tool: bun test + Bash
    Preconditions: linked image round-trip tests exist
    Steps:
      1. Save/export a document containing linked images
      2. Reopen the resulting `.fig`
      3. Assert images still render from embedded bytes
    Expected Result: saved artifact is portable as a snapshot
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-10-fig-roundtrip.txt

  Scenario: Collab byte sync remains intact
    Tool: bun test
    Preconditions: focused collab/image sync test exists
    Steps:
      1. Simulate linked image byte update in one peer/store
      2. Assert remote peer receives bytes under the stable image key
    Expected Result: collaborative rendering still works at byte level
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-10-collab-sync.txt
  ```

- [x] 11. Three-linked-image proof workflow

  **What to do**:
  - Build the proof flow that places three linked images on a board.
  - Demonstrate initial render plus post-update refresh using alternate fixture images.
  - Ensure this workflow is scripted/repeatable, not a one-off manual hack.

  **Must NOT do**:
  - Do not rely on a human manually dragging assets around as the only proof.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: focused proof assembly and repeatable scripting.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: 5, 6, 7, 8, 9, 10

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/fitbot/tmp/fitbot-openpencil-board.fig` - existing proof-board direction
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/cli/src/commands/new.ts` - current board-generation precedent
  - Task 5 fixtures - proof image source set

  **Acceptance Criteria**:
  - [ ] Board contains exactly three linked images from configured sources
  - [ ] Changing at least one source updates the board without reopening the document
  - [ ] Proof commands/steps are scripted and documented

  **QA Scenarios**:

  ```
  Scenario: Proof board loads three linked images
    Tool: Playwright + Bash
    Preconditions: OpenPencil app running with proof board workflow available
    Steps:
      1. Open the proof board file/session
      2. Assert three linked image nodes render with distinct visible content
      3. Capture screenshot of the loaded board
    Expected Result: all three linked images are visible simultaneously
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-11-proof-board.txt

  Scenario: Proof board updates after source swap
    Tool: Bash + Playwright
    Preconditions: alternate fixture images available for at least one linked source
    Steps:
      1. Replace one proof source image with its alternate variant
      2. Wait for watch/manual refresh path
      3. Assert board now shows the updated variant while other linked images remain visible
    Expected Result: partial board refresh works as expected
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-11-proof-refresh.txt
  ```

- [x] 12. Broken/stale-state polish and retry behavior

  **What to do**:
  - Implement the visible board/UI treatment for loading, stale, and broken linked sources.
  - Add retry/manual refresh behavior for failed or rate-limited sources.
  - Ensure broken linked images do not crash rendering or silently disappear.

  **Must NOT do**:
  - Do not hide failure through blank white boxes with no visible explanation.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: this is stateful product polish in the UI/render layer.
  - **Skills**: [`ui-content-design`]
    - `ui-content-design`: useful for concise failure and recovery copy.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: 3, 7, 8, 9

  **References**:
  - Task 1 product contract - required source states
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/src/components/ImageFillPicker.vue` - likely visible control surface
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/packages/core/src/canvas/fills.ts` - render fallback path constraints

  **Acceptance Criteria**:
  - [ ] Loading, broken, and stale states are distinguishable
  - [ ] Retry/manual refresh is available from broken state
  - [ ] App remains stable when linked sources are unavailable

  **QA Scenarios**:

  ```
  Scenario: Broken local or remote source shows recoverable error state
    Tool: Playwright
    Preconditions: linked image points to a missing local file or invalid URL
    Steps:
      1. Open the board/UI containing the broken linked image
      2. Assert visible broken/stale indicator exists
      3. Assert retry/relink affordance is visible
    Expected Result: failure is visible and recoverable
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-12-broken-state.txt

  Scenario: Retry succeeds after source is restored
    Tool: Bash + Playwright
    Preconditions: broken source can be restored during session
    Steps:
      1. Restore the missing/invalid source
      2. Trigger retry/manual refresh
      3. Assert image returns and error state clears
    Expected Result: recovery path works without reopening document
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-12-retry-success.txt
  ```

- [x] 13. Documentation and operator workflow for screenshot-board usage

  **What to do**:
  - Document how to use linked images for dev screenshot boards.
  - Include recommended local-server and local-file workflows, proof steps, limitations, and save/export semantics.
  - Capture future-work notes for event-stream/cloud refresh triggers without inflating v1 scope.

  **Must NOT do**:
  - Do not bury operational limitations like CORS, unavailable local paths, or snapshot save behavior.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: operator-facing workflow documentation.
  - **Skills**: [`pm-lens`]
    - `pm-lens`: helps keep workflow docs aligned with real user jobs.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: 1, 9, 10

  **References**:
  - `/Users/hassoncs/Workspaces/Personal/open-pencil/README.md` - likely operator-facing entrypoint
  - Task 11 proof workflow - concrete usage path to document
  - Task 1 product contract - promised scope and limitations

  **Acceptance Criteria**:
  - [ ] Docs explain link/relink/refresh workflow and proof board setup
  - [ ] Docs explain `.fig` snapshot semantics and linked-source limitations
  - [ ] Docs call out future-work areas separately from v1 behavior

  **QA Scenarios**:

  ```
  Scenario: Operator docs cover setup and limitations
    Tool: Bash (grep/read)
    Preconditions: linked image documentation exists
    Steps:
      1. Search docs for "linked image", "snapshot", "refresh", and "limitations"
      2. Verify each concept is documented with actionable guidance
    Expected Result: operator can understand and use the feature from docs alone
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-13-doc-coverage.txt

  Scenario: Proof workflow is documented exactly
    Tool: Bash (read)
    Preconditions: proof board instructions exist in docs
    Steps:
      1. Read the proof workflow section
      2. Verify it includes the three-image setup and update demonstration steps
    Expected Result: proof can be re-run deterministically from docs
    Evidence: .sisyphus/evidence/open-pencil-linked-images/task-13-proof-doc.txt
  ```

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit okay before completing execution.

- [x] F1. **Plan Compliance Audit** — `oracle`
      Verify every planned deliverable exists: linked registry, resolver, invalidation hook, watch flow, UI touchpoints, proof workflow, and docs. Confirm evidence files exist under `.sisyphus/evidence/open-pencil-linked-images/`.

- [x] F2. **Code Quality Review** — `unspecified-high`
      Run `bun run check` (or document environment blocker), `bun test ./tests/engine`, and review changed files for regressions, dead branches, `any`, or renderer leakage of URL/path semantics.

- [x] F3. **Real QA Execution** — `unspecified-high`
      Execute all linked-image QA scenarios end-to-end: initial load, local watch reload, manual refresh, broken URL/file behavior, and embedded snapshot save/reopen behavior.

- [x] F4. **Scope Fidelity Check** — `deep`
      Verify v1 remained a sidecar/source-resolution layer over the current byte pipeline and did not sprawl into a full core-fill redesign.

---

## Commit Strategy

- **1**: `feat(linked-images): add external image resolver foundation` — registry, resolver, renderer invalidation, tests
- **2**: `feat(linked-images): add watch flow and UI controls` — watch/reload orchestration, picker/status UI, proof workflow
- **3**: `docs(linked-images): document screenshot board workflow` — usage docs and operator guidance

---

## Success Criteria

### Verification Commands

```bash
bun test ./tests/engine                  # Expected: linked image tests pass
bun run check                            # Expected: type/lint checks pass or documented environment blocker only
pnpm exec bun packages/cli/src/index.ts new <proof.fig> --images ...  # Expected: proof board can be generated/updated
```

### Final Checklist

- [ ] Linked image sources resolve into stable byte-backed image slots
- [ ] Local file changes trigger reload + repaint without reopening the document
- [ ] Broken sources show visible non-crashing state
- [ ] Three linked images proof succeeds
- [ ] Embedded image workflow still works
- [ ] `.fig` save/export remains snapshot-compatible
