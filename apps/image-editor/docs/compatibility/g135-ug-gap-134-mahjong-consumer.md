# G135 / UG-GAP-134 Mahjong Consumer Evidence

Status: `PARTIAL`

Scope: nested-group RGBA8 composition in the Mahjong compatibility consumer.

## Observed consumer behavior

- `composeRgba8` accepts nested `group` and `section` layers and composites
  child output before applying the parent group's opacity and blend mode.
- The deterministic one-pixel fixture contains two nested groups, an inner
  opacity of `0.75`, an outer `screen` blend, and an outer opacity of `0.5`.
- The pixel oracle expects `[188, 0, 188, 72]`, not merely a nonzero frame.
- The seeded `+1` red-channel defect is rejected by the same oracle.

## Measurement result

| Signal | Result | Evidence |
|---|---|---|
| Nested-group scenarios | `1` | One nested two-group fixture |
| Nonzero outputs | `1` | RGBA8 output alpha `72` |
| Exact pixel oracle | `PASS` | `[188, 0, 188, 72]` |
| Seeded-defect rejection harness | `PASS` | Expected output differs from seeded red `+1` |
| Consuming model effect | `PASS` | `composeRgba8` returns the asserted frame |
| Browser/runtime editor effect | `UNKNOWN` | No served browser receipt in this worker lane |
| Physical-device effect | `UNKNOWN` | No named iOS Safari or Android Chrome run |
| External-editor effect | `UNKNOWN` | No Photoshop, Affinity, Krita, or Photopea run |

## Identity

- Mahjong implementation commit: `fda4c79f41cf1cd2c149a110962ac98dc8f562e9`.
- Fresh `origin/main`: `33ca13aeb0d4ef0ebc67f36fab9089c94b5bc74a`.
- Runtime: Node `v26.5.0`, npm `11.17.0`.
- Focused test: `src/app/model/composition-full.spec.ts`.

## Verification boundary

- VR-M focused model test: `PASS`.
- VU-M compatibility consumer model effect: `PASS`.
- VC-M browser/served compatibility effect: `UNKNOWN`.
- A separate before-fix implementation mutation was not run; pre-fix failure is
  `UNKNOWN`.
- Full app typecheck, full lint, and app build: pending final team gate.

Nested-group composition is now pinned to a consuming pixel contract. This
does not establish CPU/GPU backend parity, browser behavior, physical-device
behavior, or external-editor fidelity.
