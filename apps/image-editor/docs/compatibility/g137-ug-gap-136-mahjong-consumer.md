# G137 / UG-GAP-136 Mahjong Consumer Evidence

Status: `PARTIAL`

Scope: hostile editor archive and PSD budget admission in the OpenPencil image-editor app.

## Observed consumer behavior

- `EditorAssetRegistry.restore` rejects archives above the 512-asset or 128 MB
  serialized-asset limits with `E_EDITOR_ARCHIVE_BUDGET` before image decode.
- `importPsd` checks the 128 MB file limit and editor dimension/pixel limits
  before `ag-psd` receives the buffer. Budget failures use
  `E_PSD_IMPORT_BUDGET`; malformed containers still use
  `E_PSD_IMPORT_CORRUPT`.
- The deterministic hostile corpus exercises one 513-asset archive and one
  8193x4096 PSD header. Both produce typed failures.
- The seeded-defect branch replaces both guards with successful no-ops. The
  same evidence function reports two failures, proving the harness fails when
  the admission checks disappear.

## Measurement result

| Signal | Result | Evidence |
|---|---|---|
| Hostile scenarios | `2` | Archive count and PSD dimension budgets |
| Typed outputs | `2` | `E_EDITOR_ARCHIVE_BUDGET`, `E_PSD_IMPORT_BUDGET` |
| Seeded-defect failures | `2` | Both omitted guards detected |
| Focused consumer spec | `PASS` | 1 file, 2 tests |
| Related consumer suite | `PASS` | 10 files, 49 tests |
| Modified-file lint | `PASS` | Three implementation/proof files |
| App typecheck | `FAIL` | Existing `CompositeBlendMode` error in `three-compositor.ts` |
| Spike typecheck | `FAIL` | Existing compositor/demo/consumer-loading errors outside this write set |
| Consuming model effect | `PASS` | Admission rejects before decode |
| Browser/runtime editor effect | `UNKNOWN` | Launch receipt identifies inputs, but no editor import effect |
| Physical device effect | `UNKNOWN` | No named iOS Safari or Android Chrome run |
| External editor effect | `UNKNOWN` | No Photoshop or Photopea reopen required or observed |

## Identity

- OpenPencil image-editor app commit and `origin/main`:
  `f96bddc9ee2900c4b471e7153830071036e94795`.
- Runtime: Node `v26.5.0`, npm `11.17.0`.
- Consumed `@open-pencil/core`: `0.13.2`, package producer commit
  `0e9de0c5f91d550f5f2808ad816d0267a15dc173`.
- Current OpenPencil `origin/main` observed separately:
  `f988dc9747daeb08bcbfeda415db7360582f7263`. This source tip is not claimed as
  the installed package identity.
- Immutable launch receipt:
  `.omx/ultragoal/launch-20260811T073557Z-r175/launch-receipt.json`, SHA-256
  `3a3639e9082f2d573ae1901fc6c2d506bec19c6ab32655d60f98cc7abf5eeb79`.
  Its exact producer tips are OpenPencil `f988dc9747daeb08bcbfeda415db7360582f7263`,
  ch5-packages `0f5150d51a1813995f5c34c2d1c51002a02198e0`, and Mahjong
  `1d6a21a8011572623c2b3b213bc7d8633d2e3261`.

## Acceptance boundary

The deterministic model gap is closed. Runtime, browser, physical-device, and
external-editor effects remain typed `UNKNOWN`; source and unit proof do not
substitute for those consuming surfaces. Full repository typecheck remains
blocked by pre-existing errors outside this task's write set.
