# G130 / UG-GAP-129 Mahjong Consumer Evidence

Status: `UNKNOWN`

Scope: offline cache and runtime-version compatibility for the Mahjong
compatibility consumer only.

## Observed source contract

- `spikes/three-compositor-react/src/editor/runtime-loader.ts` defers the
  compositor chunk and rejects package or runtime version mismatches with
  `E_RUNTIME_VERSION_MISMATCH`.
- `spikes/three-compositor-react/src/editor/runtime-loader.spec.ts` covers
  deferred loading, shared requests, and stale runtime/package rejection.
- The loader treats a missing runtime-version field as acceptable, and its
  shared promise retains a rejected load. These are source-level risks, not
  proof that stale offline code is safely handled.
- The consumer source has no service worker or `CacheStorage` strategy. The
  browser's HTTP cache is not an app-owned offline cache and cannot prove
  mixed-version behavior.

Source inspection is not consuming-surface proof. Do not promote the existing
runtime-loader specs to offline mixed-version evidence.

## Measurement result

No consuming-surface offline receipt was observed in this worker tree.

| Signal | Result | Reason |
|---|---|---|
| Production service-worker cache | `UNKNOWN` | No built browser/service-worker receipt |
| Offline compositor load | `UNKNOWN` | No browser execution while offline |
| Mixed-version offline rejection | `UNKNOWN` | No browser execution with a stale cached chunk |
| Browser/device/external editor proof | `UNKNOWN` | Out of scope and unobserved |

The requested launch receipt
`.omx/ultragoal/launch-20260811T053300Z-g130/launch-receipt.json` is absent
from this worker tree. Dependencies are also absent, so local test, typecheck,
lint, and production-build proof cannot be promoted to consuming-surface
evidence.

## Acceptance boundary

Source tests prove configuration and guard presence only. They do not prove
service-worker cache population, offline startup, stale-cache recovery, or
physical-device behavior. Those remain `UNKNOWN` until a named browser/device
receipt observes them.
