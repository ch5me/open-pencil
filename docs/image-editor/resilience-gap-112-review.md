# UG-GAP-112 resilience review (R14, resilience-v1)

Review-and-document lane for goal `G113-ug-gap-112`, launch receipt
`.omx/ultragoal/launch-20260811T002900Z-r170`.

Gap statement (R14): *no retry policy, low-memory mode, or progressive document opening.*

Acceptance bar declared by the goal:

- resilience-v1 runs 20 loss/restart cycles per backend with silent failures = 0
- 60-minute soak: warm-state growth ≤ 5% and ≤ 64 MiB D1 / ≤ 32 MiB M1
- leaked workers/contexts = 0

## Exact implementation

The renderer resilience surface is a **declaration contract, not an implementation**.

`packages/core/src/canvas/image-editor/types.ts`

- `RendererResilienceContract` (`renderer-resilience-v1`) declares eight dimensions, three of
  which cover this gap: `lowMemoryProgressiveOpen`, `resolutionDowngrade`, `longSessionLeakGuard`.
- `createRendererResilienceContract()` defaults **every** dimension to `"UNKNOWN"`
  (`types.ts:27-39`).
- `validateRendererResilienceContract()` checks only the version literal and enum membership of
  each state (`types.ts:41-64`). Nothing anywhere requires a `"SUPPORTED"` claim to be backed by
  observed behavior — a caller may assert `SUPPORTED` for an unimplemented path and validation
  passes.

What *is* implemented, and what it does **not** cover:

- `packages/core/src/canvas/image-editor/adapter.ts:152-164` — `loseContext()` / `restore()` clear
  dirty state and bump `resourceGeneration`. This is real context-loss/resource-recreation
  behavior, and it maps to the `contextRestoration` / `resourceRecreation` dimensions. **It is not
  gap-112 progress**: it contains no retry, no memory-pressure response, and no staged open.
- `packages/core/src/canvas/image-editor/tiling.ts:46-102,147-159` — `ImageTextureMemoryBudgetError`
  and `chooseTextureScale()` downscale a texture to fit a *declared* `textureMemoryBudgetBytes`,
  and throw when even one RGBA pixel will not fit. This is a static per-texture budget check at
  plan time. It is adjacent to, but not, a low-memory mode: there is no runtime memory-pressure
  signal, no downgrade of an already-open document, and no progressive/staged document open.

Absent entirely — no retry policy, no backoff, no cancellation/abort wiring, no progressive open
path, no soak or leak instrumentation.

### Absence evidence

Commands run from the worker-3 worktree root, scoped to `packages/core/src` and `tests`:

| Search (`rg -n -i`) | Result |
| --- | --- |
| `retryPolicy\|retry policy\|backoff` | 0 relevant hits (only `fallbackOffsets` in `text/derived-text/clipboard.ts`) |
| `progressiveOpen\|progressive open\|progressive document` | only the `lowMemoryProgressiveOpen` contract field + its two test assertions |
| `resolutionDowngrade` | only the contract field + its test assertion |
| `soak` | 0 hits |
| `leakGuard\|leaked workers` | only the `longSessionLeakGuard` contract field + its test assertion |
| `lowMemory\|low-memory\|memoryBudget\|memory budget` | `tiling.ts` static texture budget + tests only |

Every vocabulary hit for the three gap items resolves to the contract's own field names or to a
test asserting those fields are `"UNKNOWN"`. No behavior backs them.

## Tests

Existing coverage (`tests/engine/editor/image-render.test.ts:705-730`):

- `renderer-resilience-v1 records unsupported runtime paths as UNKNOWN` — asserts
  `lowMemoryProgressiveOpen` and `readbackTimeout` stay `UNKNOWN`, and that a wrong version throws.
- `renderer-resilience-v1 defaults every unobserved dimension to UNKNOWN` — asserts the full
  default object.

These tests pin the *honesty* of the contract (unobserved ⇒ `UNKNOWN`). They are not resilience
tests: they exercise no loss/restart cycle, no memory pressure, and no open path.

`tests/engine/editor/image-tiling.test.ts:86-120` covers `chooseTextureScale` budget adaptation and
the `ImageTextureMemoryBudgetError` throw — the static budget path only.

Missing for `RESILIENCE-GAP-112` acceptance:

- 20 loss/restart cycles per backend, asserting silent failures = 0
- 60-minute soak with warm-state growth measurement against the 5% / 64 MiB D1 / 32 MiB M1 bounds
- leaked worker/context count assertion
- retry-policy unit coverage (attempt counts, backoff, terminal failure surfacing)
- progressive-open staging assertions

## Push

Not pushed by this worker. Per the team inbox protocol, worker-3 commits into its own worktree and
the leader owns integration and any push. Remote proof: `UNKNOWN`.

## UNKNOWN proof

- **resilience-v1 20 loss/restart cycles, silent failures = 0** — `UNKNOWN`. Never run; no harness
  exists.
- **60-minute soak, warm-state growth ≤ 5% and ≤ 64 MiB D1 / ≤ 32 MiB M1** — `UNKNOWN`. No soak
  instrumentation in the repo (`rg -i soak` → 0 hits).
- **leaked workers/contexts = 0** — `UNKNOWN`. No leak accounting; `longSessionLeakGuard` is a
  declared field defaulting to `UNKNOWN`.
- **End-to-end feature behavior** — `UNKNOWN`, because the feature is not implemented. Tasks 1
  (implement) and 2 (test) for `G113-ug-gap-112` were still `pending` at the time of this review.

The contract correctly reports `UNKNOWN` for all three gap dimensions today. That is the accurate
state, not a defect — the defect would be flipping any of them to `SUPPORTED` before the acceptance
runs exist.

## Review findings for the implement/test lanes

1. **Validation cannot detect a false `SUPPORTED`.** `validateRendererResilienceContract` is a
   shape check. When gap-112 lands, the `SUPPORTED` claim for each dimension should be produced by
   the observing harness rather than hand-written by a caller, or the contract stays a wish.
2. **Do not read existing `loseContext`/`restore` as gap-112 coverage.** It satisfies different
   dimensions; conflating them would close the gap without a retry policy, low-memory mode, or
   progressive open.
3. **The static texture budget is the natural seam for low-memory mode**, but it is plan-time and
   per-texture. Runtime memory pressure and downgrade of an already-open document need a new signal.

## Verification

Docs-only change; no source files were modified by this lane.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck + lint | `bun run check` | see below |
| Unit tests | `bun test ./tests/engine` | see below |
| End-to-end feature proof | — | `UNKNOWN` — feature not implemented; tasks 1/2 pending |
