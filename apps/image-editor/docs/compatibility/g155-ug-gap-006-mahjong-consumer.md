# G155 / UG-GAP-006 Consuming RGBA8 Pixel Composition Audit

Status: `BLOCKED`

Scope: real Mahjong consuming RGBA8 composition pixels behind
`composition-full-v1`: GROUP/SECTION clipping, raster masks, rotation,
adjustment hooks, and CPU/GPU parity.

## Acceptance contract

`UG-GAP-006` is not accepted until all of these gates pass:

1. The consuming renderer produces nonzero RGBA8 `readPixels()` output from
   the named fixture.
2. GROUP/SECTION clipping, raster masks, rotation, and adjustment hooks are
   exercised by pixels, not only declared in fixture metadata.
3. CPU and consuming renderer channels have maximum absolute delta `<= 3` and
   signed mean bias `<= 0.25`.
4. A seeded pixel defect is rejected by the verifier.
5. Renderer package, runtime, and source commit identity are recorded from the
   consuming run.
6. RGBA16F and Skia remain explicit typed unsupported gaps; no silent fallback
   is accepted.
7. Browser, physical-device, iOS Safari, Android Chrome, Photoshop, Affinity
   Photo, Krita, and Photopea behavior stays `UNKNOWN` unless directly
   observed.

## Observed source boundaries

| Gate | Evidence | Verdict |
| --- | --- | --- |
| CPU RGBA8 oracle | `src/app/model/compositor-blend.ts:97-132` performs linearized RGBA8 source-over, multiply, screen, opacity, and raster-mask composition. | `PASS` |
| Focused CPU tests | `src/app/model/compositor-blend.spec.ts:39-86` covers ordered layers, alpha, masks, linear RGBA8 quantization, and malformed dimensions. | `PASS` |
| Consuming renderer | `src/app/rendering/compositor/three-compositor.ts:210-239,303-329` renders real WebGPU/WebGL2 targets, masks, bounds, rotation, and brightness/contrast/saturation adjustment layers. | `PARTIAL` |
| GROUP/SECTION semantics | `src/app/rendering/compositor/compositor-contract.ts:5-21` has only flat `CompositorLayer` entries; no group or section type. | `FAIL` |
| Executable parity fixture | `scripts/three-compositor-parity/parity.ts:52-110` uses flat bottom/middle/top layers. `composition-full-v1` declares groups and clipping but does not execute nested GROUP/SECTION pixels. | `FAIL` |
| Verifier tolerance | `scripts/verify-three-compositor-parity.mjs:38-75` checks max channel delta `<= 3` and signed mean bias `<= 0.25` for flat scenarios. | `PASS` for flat scenarios |
| Seeded-defect rejection | `scripts/verify-three-compositor-parity.mjs:65-75,137-145` rejects a seeded `+4` pixel channel defect for each flat scenario. | `PASS` for flat scenarios |
| Unsupported formats | Renderer targets use `RGBAFormat` + `UnsignedByteType` at `src/app/rendering/compositor/three-compositor.ts:303-305`; no typed RGBA16F/Skia consumer rejection contract found. | `FAIL` |
| Adjustment coverage | GPU shader applies brightness/contrast/saturation at `src/app/rendering/compositor/three-compositor.ts:325-329`; blur is not represented by the GPU contract. | `PARTIAL` |

## Verification

- Focused CPU compositor tests: `PASS` — 7 tests passed.
- Typecheck: `PASS` — `npm run typecheck`.
- Full lint: `FAIL` — pre-existing repository-wide failures, 96 errors in
  unrelated files; no G155 source edits were linted.
- Flat consuming parity proof: `PASS` — WebGPU and WebGL2 report nonzero
  `readPixels()` output, max channel delta `2`, signed mean bias `0.0000`,
  seeded `+4` channel rejection, and
  `compositor-package-v1/three-compositor-v1` identity.
- Required nested consuming parity proof: `UNKNOWN` — GROUP/SECTION pixels and
  typed RGBA16F/Skia rejection are not exercised by the flat runner.
- Browser, physical-device, iOS Safari, Android Chrome, Photoshop, Affinity
  Photo, Krita, and Photopea: `UNKNOWN`.

## Exact source identity

| Producer/consumer | Commit | Runtime |
| --- | --- | --- |
| Mahjong worker tree | `8c7cab0a0f549bcafa2eb1387e1a1f6ab315856b` | Node `v24.14.1`, Bun `1.3.14` |
| Consuming renderer | `compositor-package-v1` / `three-compositor-v1` | WebGPU and WebGL2 parity run |

The consuming receipt covers only the flat scenarios. Do not promote fixture
metadata or flat-layer proof into nested GROUP/SECTION or external-application
proof.

## Exact acceptance result

`UG-GAP-006` stays blocked. The repository contains a real flat-layer RGBA8
CPU oracle and a Three.js consuming path, and flat RGBA8 parity is proven. The
required nested GROUP/SECTION pixel execution and typed RGBA16F/Skia gap
behavior are not proven.
