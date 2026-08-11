# UG-GAP-114 resilience review (R14, resilience-v1)

Review-and-document lane (`R-O`) for goal `G115-ug-gap-114`, launch receipt
`.omx/ultragoal/launch-20260811T010600Z-r172/launch-receipt.json`
(`producerTipSetHash=b480c2d0…6fda34`, `installedRosterHash=12c391c9…eabea`).

Gap statement (R14, quoted from the goal objective): *No render/readback timeout.*

Acceptance bar declared by the goal:

- resilience-v1 runs 20 loss/restart cycles per backend with silent failures = 0
- 60-minute soak: warm-state growth ≤ 5% and ≤ 64 MiB D1 / ≤ 32 MiB M1
- leaked workers/contexts = 0

## Exact implementation

**No render or readback timeout exists.** `readbackTimeout` is a declared contract dimension with
no behavior behind it, and nothing in the image-editor renderer bounds the duration of a render or
a pixel readback.

`packages/core/src/canvas/image-editor/types.ts`

- `RendererResilienceContract` (`renderer-resilience-v1`) declares `readbackTimeout` alongside
  `cancellation` (`types.ts:14-15`); both default to `"UNKNOWN"` (`types.ts:33-34`).
- `validateRendererResilienceContract()` (`types.ts:41-64`) checks only the version literal and
  enum membership. It cannot detect a `SUPPORTED` claim that no run produced.
- `ImageRenderAdapter.render()` (`types.ts:133-139`) is **synchronous** and returns
  `ImageRenderFrame`. There is no async boundary, no signal parameter, and no readback method on
  the adapter at all.

`packages/core/src/canvas/image-editor/resilience.ts` (landed by the gap-112/113 lanes)

- `runWithRetry()` (`resilience.ts:100-129`) retries a failed operation with exponential backoff
  (`retryDelayMs`, `resilience.ts:80-85`). It has **no deadline**: an operation that never settles
  is awaited forever and no retry is ever scheduled. Retry answers *failed*, not *hung*.
- `isRetryableImageError()` (`resilience.ts:91-98`) is an allowlist — only
  `ImageRenderContextLostError` and `ImageTextureMemoryBudgetError` retry. A future timeout error
  is non-retryable by default.
- The only `setTimeout` in the file is `defaultSleep` (`resilience.ts:425-429`), the backoff timer.
  It bounds nothing.
- `observeContextLossCycles()` (`resilience.ts:247-284`) and `observeResolutionDowngrade()`
  (`resilience.ts:354-398`) derive their contract dimensions from observed runs and never assert
  `SUPPORTED` for an unexercised path. Neither touches `readbackTimeout`; both leave it `UNKNOWN`.

Adjacent but **not** this gap:

- `packages/core/src/io/limits.ts:11-17` — `IOCancelledError` / `throwIfIOCancelled(signal)`, with
  `signal?: AbortSignal` threaded through `io/types.ts:69`, `io/formats/pen/read.ts:501,542`,
  `io/formats/psd/raster.ts:278,348`, `io/formats/psd/staged.ts:167,463`, `io/formats/fig/read.ts:21`.
  This is cooperative **cancellation** for document import — caller-driven, no deadline, and not
  wired to the renderer.
- Real readback sites (`packages/core/src/io/formats/raster/render.ts:54,196` `readPixels`;
  `render.ts:139,178,184` and `canvas/renderer/retained-backing.ts:393,418` `makeImageSnapshot`)
  are synchronous CanvasKit calls with no timeout and no instrumentation.

### Absence evidence

Commands run from the worker-3 worktree root:

| Search (`rg -n -i`) | Result |
| --- | --- |
| `timeout\|deadline\|watchdog` in `packages/core/src` | 2 hits: the `readbackTimeout` contract field and `defaultSleep`'s backoff `setTimeout` |
| `readbackTimeout` | contract field (`types.ts:14,33,52`) + 2 test assertions pinning `"UNKNOWN"` |
| `AbortSignal\|AbortController` | `packages/core/src/io/**` only — zero hits under `canvas/` |
| `readback\|readPixels\|makeImageSnapshot` | untimed synchronous CanvasKit calls in `io/formats/raster/render.ts` and `canvas/renderer/retained-backing.ts` |
| `soak` | 0 hits |

Every vocabulary hit for this gap resolves to the contract's own field name or to a test asserting
it is `"UNKNOWN"`. No behavior backs it.

## Tests

Existing coverage (`tests/engine/editor/image-render.test.ts:705-730`):

- `renderer-resilience-v1 records unsupported runtime paths as UNKNOWN` — asserts `readbackTimeout`
  stays `"UNKNOWN"` and that a wrong version throws.
- `renderer-resilience-v1 defaults every unobserved dimension to UNKNOWN` — asserts the full default
  object, `readbackTimeout` included (`:726`).

`tests/engine/editor/image-resilience-gap113.test.ts` covers retry attempt counts, backoff, the
retryable/non-retryable split, low-memory budgets, progressive open staging, and the two
observe-and-derive harnesses. **No test in the repo drives a slow or hung render/readback**, so
there is no timeout coverage to regress.

These tests pin the *honesty* of the contract (unobserved ⇒ `UNKNOWN`). That is the accurate state
today, not a defect — the defect would be flipping `readbackTimeout` to `SUPPORTED` before an
observing harness produces it.

Missing for `RESILIENCE-GAP-114` acceptance:

- a deadline unit suite: fires at the bound, does not fire under it, and reports the elapsed budget
- interaction with retry: a timeout must classify as retryable and consume exactly one attempt
- cleanup on timeout: the abandoned render/readback releases its texture and worker/context, proven
  by a leak count, not assumed
- 20 loss/restart cycles per backend under an active deadline, silent failures = 0
- 60-minute soak measuring warm-state growth against 5% / 64 MiB D1 / 32 MiB M1
- leaked workers/contexts = 0 assertion

## Review findings for the implement/test lanes

1. **A synchronous `render()` cannot be timed out.** `ImageRenderAdapter.render()` (`types.ts:135`)
   returns its frame synchronously; JavaScript cannot interrupt it. A deadline is only meaningful
   across an async boundary — an off-thread render, an async readback, or a chunked loop that checks
   a deadline between tiles. The I-O lane must either widen the adapter contract or scope the gap to
   readback plus tile-loop checkpoints, and say which. Wrapping the existing synchronous call in a
   `Promise.race` would produce a timer that reports a timeout while the blocked work still runs to
   completion — a false `SUPPORTED` and a silent failure.
2. **Reuse the existing cancellation convention; do not invent a second one.** `io/limits.ts`
   already defines `IOCancelledError` + `throwIfIOCancelled(signal)` with `signal?: AbortSignal`
   threaded through five IO modules. A deadline is naturally `AbortSignal.timeout(ms)` feeding the
   same predicate. A parallel renderer-local abort mechanism means two cancellation vocabularies
   that will disagree.
3. **A timeout error must be added to `isRetryableImageError` explicitly** (`resilience.ts:91-98`).
   The predicate is an allowlist ending in a two-class `instanceof` check, so a new
   `ImageRenderTimeoutError` falls through to `false` and `runWithRetry` will rethrow on the first
   deadline instead of retrying. This is the single most likely silent miss in the I-O lane.
4. **`runWithRetry` needs the deadline inside the attempt loop, not around it.** A per-attempt
   deadline is the useful shape (attempt 1 hangs → time out → back off → attempt 2). A deadline
   wrapped around the whole call would let one hung attempt consume the entire budget and starve the
   retries that exist to recover it.
5. **Derive `readbackTimeout` from an observing harness**, matching `observeContextLossCycles` and
   `observeResolutionDowngrade` (`resilience.ts:247,354`), which return
   `SUPPORTED`/`UNSUPPORTED` from measured runs. `validateRendererResilienceContract` is a shape
   check and will happily pass a hand-written `SUPPORTED`. Honesty here is enforced by construction
   or not at all.
6. **Timeout without cleanup is a leak.** Abandoning a render/readback must release its texture
   budget and any worker/context, or the 60-minute soak and the `leaked workers/contexts = 0` bar
   fail for a reason introduced by this gap's own fix. The `cancellation` and `longSessionLeakGuard`
   dimensions should be considered in the same change, even if only to keep them honestly `UNKNOWN`.

## Push

Not pushed by this worker. Per the team inbox protocol, worker-3 commits into its own worktree and
the leader owns integration and any push. Remote proof: `UNKNOWN`.

## UNKNOWN proof

- **resilience-v1 20 loss/restart cycles, silent failures = 0** — `UNKNOWN`. `observeContextLossCycles`
  exists and could drive them, but no run was executed under a render/readback deadline, because no
  deadline exists.
- **60-minute soak, warm-state growth ≤ 5% and ≤ 64 MiB D1 / ≤ 32 MiB M1** — `UNKNOWN`. No soak
  instrumentation in the repo (`rg -i soak` → 0 hits).
- **leaked workers/contexts = 0** — `UNKNOWN`. No leak accounting; `longSessionLeakGuard` is a
  declared field defaulting to `UNKNOWN`.
- **End-to-end feature behavior** — `UNKNOWN`, because the feature is not implemented. Tasks 1
  (implement, worker-1) and 2 (test, worker-2) for `G115-ug-gap-114` were `in_progress` with no
  gap-114 commits in their worktrees at the time of this review.
- **External named-app / device proof** — `UNKNOWN`. Nothing was observed on a named app or device.

## Verification

Docs-only change; this lane modified no source files. The worktree had no `node_modules`, so
`bun install` was run first (3398 packages) — without it both gates fail on missing modules, which
is an environment state, not a code result.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck + lint | `bun run check` | see `## Verification results` below |
| Unit tests | `bun test ./tests/engine` | see `## Verification results` below |
| Playwright E2E | `bun run test` | not run — docs-only lane, no rendering surface changed |
| `check:vue` | `bun run check:vue` | not run — documented pre-existing errors (`AGENTS.md`) |
| End-to-end feature proof | — | `UNKNOWN` — feature not implemented; tasks 1/2 in progress |

## Verification results

<!-- filled from the actual runs; see the task transition result for the same numbers -->
