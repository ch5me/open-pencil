# Texture Upload Tracking

`createImageRenderAdapter()` reports deterministic upload decisions per asset in
each returned `ImageRenderFrame`. It does not perform a Skia, WebGL, WebGPU, or
device upload.

- `uploaded: true` means the adapter has no matching cached revision, or the
  asset was explicitly invalidated with `markDirty(assetId)`.
- `uploaded: false` means the cached asset revision was reused. Unchanged
  layers therefore produce zero adapter-reported uploads.
- Shared asset bindings are deduplicated: one texture entry per visible asset,
  while each scene node still emits its own render command.
- A source or mask mutation must resolve to a new immutable asset revision and
  invalidate only that asset; unrelated textures remain reusable.

## G088 performance boundary

The image adapter only plans bounded tiles, proxy dimensions, mipmap level, and
dirty regions. It does not schedule a render graph or fuse filters into a GPU
pass. The `renderGraphScheduling` and `filterFusion` fields in the performance
evidence contract describe evidence shape; `true` is not proof that either
capability exists in this adapter or its consuming renderer.

GPU execution, external renderer parity, device performance, and filter-fusion
measurements remain `UNKNOWN` until observed on the consuming surface. The
synthetic benchmark probe is not OpenPencil render acceptance.

## G089 texture-memory and adaptive-resolution boundary

The current adapter has no measured texture-memory budget and no adaptive
resolution controller. `maxTiles` is a deterministic tile-plan safety limit,
not a byte budget; `proxyMaxDimension` is an explicit caller-selected scale,
not automatic pressure response. `ImageTilePlan` therefore describes planned
dimensions and tile count only. It does not report resident GPU bytes,
allocation/reclamation behavior, eviction, or a resolution downgrade decision.

The performance probe at
`docs/image-editor/probes/performance-d1-m1-2026-08-09.json` records synthetic
CPU timings and a process peak, but `memory.appPeakBytes`, `gpuProfile`, and M1
measurements are `UNKNOWN`. Do not promote those values into a texture budget,
GPU-memory claim, low-memory guarantee, or adaptive-resolution proof.

Low-memory progressive open, resource recreation, and resolution downgrade
remain `UNKNOWN` in `renderer-resilience-v1`. A future implementation must
carry an observed byte budget and pressure signal through the consuming
renderer, then verify downgrade, recovery, and restoration on target devices.

## G091 100/512-layer GPU benchmark boundary

The `layer100` and `layer512` samples in the performance probe are synthetic
CPU timings. They are not GPU timings, frame captures, or OpenPencil consuming
renderer measurements. No measured 100-layer or 512-layer GPU benchmark exists
in this revision, so both GPU benchmark results remain `UNKNOWN`.

Do not infer GPU throughput, frame budget, device parity, or renderer
acceptance from either sample set. A valid benchmark must observe the
consuming renderer and record its GPU/device identity with the measured
workload.

## Partial updates

The adapter carries a typed `update.dirtyRect` and uses it to restrict the
reported tile plan. This proves deterministic region planning only. The adapter
does not execute a Skia or GPU subresource upload, so physical partial-upload
behavior remains `UNKNOWN` until verified in the consuming renderer.

## Revision contract

Revision IDs must be immutable content identities. A resolver must return a
revision whose `revisionId` matches the binding's requested revision ID.
Resolvers that mutate bytes under one ID, or return a different revision ID,
violate this contract and can make `uploaded: false` stale or associate bytes
with the wrong asset revision.

External renderer, performance, and device parity remain `UNKNOWN` until
observed on those consuming surfaces.

## G112 / UG-GAP-111 resilience boundary

The current OpenPencil image adapter exposes a typed
`renderer-resilience-v1` contract, but it does not own GPU context-loss
recovery, resource recreation, worker lifecycle accounting, or long-session
soak measurement. The default contract therefore reports every resilience
dimension as `UNKNOWN`; setting a field to `SUPPORTED` is evidence metadata,
not an implementation of recovery.

UG-GAP-111 acceptance requires a consuming-backend probe with all of the
following evidence:

- 20 loss/restart cycles for each backend, with zero silent failures.
- A 60-minute warm-state soak with growth at or below 5%.
- Observed memory at or below 64 MiB for D1 and 32 MiB for M1.
- Zero leaked workers and renderer contexts after teardown.

The existing adapter and unit tests do not observe those surfaces, so
UG-GAP-111 remains `UNKNOWN`. Do not infer loss recovery, memory bounds,
leak-freedom, or backend switching from contract construction, synthetic
benchmarks, or tile-plan output. A future proof must record backend identity,
cycle counts, warm-state samples, memory profile, and teardown counts from the
consuming renderer.
