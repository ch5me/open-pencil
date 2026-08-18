# G153 / UG-GAP-152 Broader Format Acceptance Audit

Status: `BLOCKED`

Scope: exact acceptance for TIFF, PDF, EXR, RAW, and advanced SVG support:
stable worker/archive boundary, license and corpus contract, memory contract,
at least ten hashed files per support class, 100% warning completeness, and
hostile-input limits.

## Acceptance contract

`UG-GAP-152` is not accepted until every support class has a versioned,
provenance-bound corpus and all of these gates pass:

1. At least ten hashed files exist for TIFF, PDF, EXR, RAW, and advanced SVG.
2. Every corpus file has provenance plus license/redistribution status.
3. Worker and archive boundaries are stable and versioned.
4. Memory limits cover decode, expansion, cancellation, and publication.
5. Warning expectations and observed warnings match exactly (100%).
6. Hostile limits reject oversized, malformed, and expansion-heavy inputs before
   unsafe allocation.
7. Browser, physical-device, and external-editor effects remain separate
   `UNKNOWN` claims unless directly observed.

## Cross-repository evidence

| Gate | OpenPencil | Mahjong | Verdict |
| --- | --- | --- | --- |
| Registered support | Built-in registry includes PDF and SVG export; no TIFF, EXR, or RAW adapter in `packages/core/src/io/formats.ts:331-340` | Import accepts `.mah`, `.lay`, and `.layout`; `src/app/modules/editor/model/import.ts:227-250` | `PARTIAL` |
| Hashed corpus | No TIFF/TIF/PDF/EXR/RAW/SVG corpus files found under `tests`; no ten-file manifest | No broader-format corpus or hash manifest | `FAIL` |
| License/redistribution | Repository has a license, but no per-corpus provenance or redistribution manifest | Repository is MIT-licensed (`LICENSE:1`); no format corpus manifest | `PARTIAL` |
| Worker/archive boundary | Worker, archive, and memory contracts exist; archive proof covers generic hostile IO, not these formats | No broader-format worker/archive authority | `PARTIAL` |
| Memory contract | `docs/image-editor/archive-budget-proof-2026-08-11.md:27-34` proves generic archive/PSD guards and zero-byte publication guard | Import has only a 10 MB file-size gate at `src/app/modules/editor/model/import.ts:5,227-230` | `PARTIAL` |
| Warning completeness | No broader-format warning matrix or 100% result | No warning matrix for TIFF/PDF/EXR/RAW/advanced SVG | `UNKNOWN` |
| Hostile limits | Generic archive/PSD hostile tests pass, but no per-format hostile corpus | No per-format hostile-limit tests | `PARTIAL` |
| Consuming output identity | No consuming browser or external-editor artifact | No consuming broader-format artifact | `UNKNOWN` |

## Exact corpus count

The acceptance count is `0/10` for every required class:

| Support class | Hashed files observed | Required | Result |
| --- | ---: | ---: | --- |
| TIFF | 0 | 10 | `FAIL` |
| PDF | 0 | 10 | `FAIL` |
| EXR | 0 | 10 | `FAIL` |
| RAW | 0 | 10 | `FAIL` |
| Advanced SVG | 0 | 10 | `FAIL` |

OpenPencil SVG and PDF unit tests are not corpus files and cannot substitute
for hashed fixtures. Mahjong layout fixtures are not TIFF/PDF/EXR/RAW/SVG
fixtures.

## Exact acceptance result

`UG-GAP-152` stays blocked:

- Hashed corpus gate: `FAIL` (`0/10` in every class).
- License and redistribution manifest: `FAIL` for the required corpus
  contract; repository-level MIT license alone is insufficient.
- Warning completeness: `UNKNOWN`; no format-specific expected/observed
  warning matrix exists.
- Hostile limits: `PARTIAL`; generic archive and PSD guards do not prove the
  five required support classes.
- Memory contract: `PARTIAL`; generic worker/archive limits exist, but no
  format-specific decode and peak-memory evidence exists.
- Stable broader-format worker/archive boundary: `UNKNOWN` for Mahjong and
  unsupported classes.

This audit preserves browser, physical-device, iOS Safari, Android Chrome, and
external-editor behavior as `UNKNOWN`.

## Verification

- Source and documentation inspection across the Mahjong checkout and the
  OpenPencil G130 checkout: `PASS`.
- Required hashed corpus count: `FAIL`, `0/10` for each class.
- Warning completeness, format-specific hostile limits, and consuming effects:
  `UNKNOWN` or `PARTIAL`; no claim upgraded without direct evidence.
- Full typecheck, lint, and browser/E2E execution: not required for this
  docs-only fail-closed audit.
