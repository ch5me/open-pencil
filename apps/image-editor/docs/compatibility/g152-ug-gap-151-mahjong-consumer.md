# G152 / UG-GAP-151 Print and Prepress Acceptance Audit

Status: `BLOCKED`

Scope: H2.5, accepted ADR/contract/security/memory/archive gates, and the
print/prepress trigger for ICC, DPI, CMYK, and spot-color support across
OpenPencil, Mahjong, and ch5-packages.

## Acceptance contract

`UG-GAP-151` may start only after all of these are accepted:

1. H2.5 ownership convergence is complete and hash-bound.
2. An accepted ADR names the production owner, migration boundary, and removal
   trigger for compatibility adapters.
3. A versioned contract covers ICC profile identity, assignment versus
   conversion, DPI, CMYK, spot colors, rendering intent, black-point
   compensation, and missing-profile behavior.
4. Security and memory limits cover hostile profile/archive inputs, bounded
   parsing, cancellation, and named-device peak memory.
5. Archive authority and worker boundaries are accepted.
6. At least three normative fixtures have provenance, SHA-256, expected profile
   and output settings, and license/redistribution status.
7. Named reference outputs stay within declared profile tolerance.
8. Missing profiles produce an explicit typed outcome; silent fallback count is
   zero.
9. The consuming editor emits nonzero output with exact renderer identity.

## Cross-repository evidence

| Gate | OpenPencil | Mahjong | ch5-packages | Verdict |
| --- | --- | --- | --- | --- |
| H2.5 ownership/hash | Authority matrix and path allocation exist; H2.5 duplicate-authority and consuming-path proof remains a retirement trigger | Compatibility consumer only; no H2.5 receipt | No image-editor production authority found | `UNKNOWN` |
| Accepted ADR | Production-owner plan is still a draft execution artifact; no accepted print/prepress ADR | No print/prepress owner or migration contract | No print/prepress authority | `UNKNOWN` |
| ICC/DPI/CMYK/spot contract | `DocumentColorSpace` and RGB preview conversion exist; no ICC identity, DPI, CMYK, or spot-color fields | Legacy PSD adapter has no such contract | No relevant contract | `FAIL` |
| Security and memory | Archive budget proof covers declared-size, ZIP expansion, PSD limits, cancellation, and zero-byte output; no color-profile hostile corpus or named-device peak proof | Hostile archive guards exist, but no print/prepress profile proof | No relevant proof | `PARTIAL` |
| Archive authority | `open-pencil-fig-kiwi`, version-preserving container, staged worker output, host-owned commit | Legacy `ch5.editor.archive.v1` consumer path | No editor archive authority | `PASS` for prerequisite only |
| Normative fixtures | No print/prepress fixture manifest | No ICC/DPI/CMYK/spot fixtures | No relevant fixture manifest | `FAIL` |
| Reference output delta | No named renderer/reference output or profile tolerance | No print/prepress output | No named renderer/reference output | `FAIL` |
| Missing-profile behavior | No typed missing-profile result; no silent-fallback counter | No profile behavior | No profile behavior | `FAIL` |
| Consuming output and renderer identity | Archive proof explicitly leaves browser/GPU/external behavior `UNKNOWN` | No consuming print/prepress artifact | No consuming artifact | `UNKNOWN` |
| External Photoshop/Affinity/Krita/Photopea | No observed external application run | No observed external application run | No observed external application run | `UNKNOWN` |

## Observed source boundaries

- OpenPencil `packages/core/src/editor/color-space.ts` supports only
  `DocumentColorProfileMode = "assign" | "convert"` and remaps preview colors.
- OpenPencil `packages/core/src/editor/image-contracts/index.ts` declares
  document-primaries-linear composition and an archive protocol, but no
  ICC/DPI/CMYK/spot-color fields.
- OpenPencil `docs/image-editor/archive-budget-proof-2026-08-11.md` records
  `61 pass`, seeded aggregate-expansion and zero-byte defects, and explicitly
  leaves browser, GPU, named-device, and external-application behavior
  `UNKNOWN`.
- Mahjong `src/app/adapters/editor-psd.ts` and the legacy archive path provide
  compatibility behavior, not print/prepress ownership.
- ch5-packages has no image-editor print/prepress authority or consuming proof.

## Exact acceptance result

`UG-GAP-151` stays blocked. The trigger is not met:

- ICC/DPI/CMYK/spot-color contract: `FAIL`.
- Accepted product requirement: `UNKNOWN`.
- H2.5 and accepted ADR: `UNKNOWN`.
- Three normative fixtures: `FAIL`.
- Named reference-output delta: `FAIL`.
- Missing-profile silent fallbacks equal zero: `FAIL` because no typed behavior
  or counter exists.
- Nonzero consuming output with renderer identity: `UNKNOWN`.

This audit does not claim browser, physical-device, Safari, Photoshop,
Affinity, Krita, or Photopea behavior.

## Verification

- Source inspection across all three repositories: `PASS`.
- Existing OpenPencil archive proof readback: `PASS` for archive prerequisite
  only; not print/prepress acceptance.
- H2.5/ADR/color/fixture/reference/consumer gates: `FAIL` or `UNKNOWN` as
  tabulated above.
- Full typecheck, lint, and E2E: not run; this is a docs-only fail-closed audit.
