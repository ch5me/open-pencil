# G129 / UG-GAP-128 Mahjong Consumer Evidence

Status: `UNKNOWN`

Scope: low-end-phone parse, compile, and startup measurement for the Mahjong
compatibility consumer only.

## Observed source contract

- `spikes/three-compositor-react/src/editor/runtime-loader.ts` defers the
  compositor chunk and rejects package or runtime version mismatches with
  `E_RUNTIME_VERSION_MISMATCH`.
- `spikes/three-compositor-react/src/editor/consumer-loading.ts` validates the
  consumer factory and shares one in-flight import promise.
- Focused specs cover deferred loading, shared requests, observable import
  failures, factory validation, and mixed-version rejection.

These source and model-test checks do not measure low-end parse time, compile
time, gzip size, or first-interactive startup latency.

The existing desktop gameplay report combines board build and texture compile
in a warm `rendererReadyMs` aggregate. It is not a separate low-end
`parseMs`, `compileMs`, or `startupMs` measurement and must not be promoted to
this gap's acceptance evidence.

## Measurement result

No approved low-end measurement was observed in this worker tree.

| Signal | Result | Reason |
|---|---|---|
| Parse time | `UNKNOWN` | No low-end device/profile receipt |
| Compile/init time | `UNKNOWN` | No low-end device/profile receipt |
| Compatibility compositor gzip | `UNKNOWN` | Production/storybook bundles not built here |
| Editor first-interactive p75 | `UNKNOWN` | No consuming-surface startup trace |
| Offline mixed-version load | `UNKNOWN` | No runtime/browser execution receipt |

The requested launch receipt
`.omx/ultragoal/launch-20260811T051100Z-g129/launch-receipt.json` is not
present in this worker tree. Dependencies are also absent
(`node_modules`), so test, typecheck, lint, and production-build proof cannot
be promoted to this evidence record.

## Acceptance boundary

Do not infer low-end or external-editor compatibility from the existing
TypeScript specs. Browser, GPU, physical-device, Photoshop, Affinity, Krita,
and Photopea evidence remain `UNKNOWN` unless separately observed with named
receipts.

Next measurement needs a fresh approved receipt, a frozen install, a named
low-end profile, production bundle output, and a startup trace that records
parse, compile/init, and first-interactive timings.
