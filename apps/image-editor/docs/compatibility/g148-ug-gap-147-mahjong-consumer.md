# G148 / UG-GAP-147 RGBA16F and HDR Trigger Audit

Status: `BLOCKED`

Captured at: `2026-08-11T17:54:51Z`

Scope: RGBA16F/HDR prerequisites only. This audit does not implement HDR.

## Start gate

R18-GAP-147 may start only when all of these are observed at one exact
three-repository tip set:

1. RGBA16F consumer contract, backend capability, and parity proof.
2. Color-space/profile contract bound to archive and renderer semantics.
3. Archive and worker boundaries preserve precision/profile metadata.
4. Named device support and frozen-profile peak-memory proof.
5. At least three precision/profile HDR fixtures with declared provenance.
6. Clipping escapes and NaN/Inf escapes are both zero in the fixture corpus.
7. Consuming output is nonzero and carries exact renderer/runtime identity.

## Current tip set

| Repository | Current `origin/main` |
| --- | --- |
| OpenPencil | `bb84b948af4986c61cb61ab46233755f8a414da7` |
| ch5-packages | `e8f5ce30b46027f390addda90e153e4e0daee10d` |
| mahjong-ch5 | `fdfbf5973eb7d54e1e7e29a45b054b54c0accff3` |

Worker source checkout was `ac094248b29a11566019a991268227e1204f81c0`; the
origin/main identity above is the current source authority for freshness.

## Evidence matrix

| Gate | OpenPencil current main | Mahjong current main | Verdict |
| --- | --- | --- | --- |
| RGBA16F contract | `RasterPixelFormat` declares `rgba16f-linear-premultiplied`, but raster composition emits `rgba16f-unavailable`; the composition contract is declarative | `composeRgba16f()` emits typed `E_RGBA16F_UNSUPPORTED`; compositor is RGBA8/UnsignedByteType | `PARTIAL` |
| Color/profile contract | Versioned document-linear premultiplied composition and Display-P3/sRGB color management exist | `EditorDocument` has no profile/format fields; compositor is sRGB-only | `PARTIAL` |
| Archive/worker boundary | Transactional worker protocol has D1/M1 limits and peak accounting | PNG data-URL assets and legacy document/viewport persistence carry no HDR/profile metadata | `PARTIAL` |
| Three HDR fixtures | No three precision/profile HDR fixture corpus observed | `composition-full-v1` has one nominal `rgba16fSkia` tolerance, not HDR fixtures | `FAIL` |
| Clipping escape proof | Clipping tests are RGBA8/general raster only | Existing clipping tests are RGBA8/general raster only | `PARTIAL` |
| NaN/Inf escape proof | Generic input validation exists; no HDR output escape corpus | Generic geometry validation exists; no HDR output escape corpus | `FAIL` |
| Frozen-profile peak memory | D1/M1 limits exist, but observed peak evidence allows `UNKNOWN` | No named-device HDR peak receipt | `UNKNOWN` |
| Consuming device effect | GPU profile may be `UNKNOWN` | No physical iOS Safari/Android Chrome HDR receipt | `UNKNOWN` |

## Observed Mahjong boundaries

- `src/app/model/composition-full.ts:11-16` declares
  `E_RGBA16F_UNSUPPORTED` and `E_SKIA_UNSUPPORTED`.
- `src/app/model/composition-full.ts:285-290` keeps RGBA16F and Skia
  fail-loud typed gaps. This is the required no-silent-fallback behavior.
- `src/app/model/editor-document.ts:167-173` defines only version, dimensions,
  layers, and selection. No profile identity, pixel format, transfer function,
  or HDR metadata can round-trip.
- `src/app/rendering/compositor/three-compositor.ts:108-112` selects
  `UnsignedByteType`, sRGB output, and no tone mapping.
- `src/app/rendering/compositor/three-compositor.ts:303-306` creates an RGBA8
  `UnsignedByteType` target with `NoColorSpace`.
- `src/app/rendering/editor-asset-registry.ts:411-445` serializes and restores
  PNG data URLs only.
- `scripts/three-compositor-parity/fixtures/composition-full-v1.json:23-30`
  declares an `rgba16fSkia` tolerance, but the fixture has no precision/profile
  scenarios, HDR samples, clipping escape count, or NaN/Inf escape count.

## Acceptance result

`UG-GAP-147` remains blocked. Do not add an HDR implementation, profile parser,
RGBA16F conversion, or compatibility approximation. Keep existing typed
`E_RGBA16F_UNSUPPORTED` and `E_SKIA_UNSUPPORTED` boundaries.

Required next proof: a fresh current-tip fixture manifest with three HDR
precision/profile cases, clipping and NaN/Inf escape counters, profile-preserving
archive reopen, frozen D1/M1 peak-memory measurements on named devices, and
nonzero consuming output with exact renderer identity.

Subagent evidence: one bounded read-only review probe; integrated findings on
partial upstream contracts, typed Mahjong unsupported behavior, missing HDR
fixture/escape proof, and unknown device-memory effect.
