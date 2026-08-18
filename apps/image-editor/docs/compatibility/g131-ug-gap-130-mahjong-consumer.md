# G131 / UG-GAP-130 Mahjong Consumer Evidence

Status: `UNKNOWN`

Scope: mask-stroke undo behavior in the Mahjong compatibility consumer.

## Observed source boundary

- `EditorAssetRegistry.paintMask` mutates a mask canvas and increments an
  asset revision.
- `DocumentHistory` records document commands, but no mask-stroke command
  connects `paintMask` to that history.
- Existing raster capability-gap tests assert that unsupported raster paint
  does not mutate document history. They do not prove mask-canvas undo or
  redo.

Source inspection is not seeded-defect proof. A source-level `DocumentHistory`
test cannot prove that a mask stroke is captured, undone, redone, and rendered
through the consuming editor.

## Measurement result

No named consuming-surface receipt or exact seeded-defect fail proof was
observed in this worker tree.

| Signal | Result | Reason |
|---|---|---|
| Mask-stroke history transaction | `UNKNOWN` | No mask-stroke command or receipt observed |
| Undo restores prior mask pixels | `UNKNOWN` | No canvas-level mask undo test observed |
| Redo reapplies mask pixels | `UNKNOWN` | No canvas-level mask redo test observed |
| Seeded defect fails before fix | `UNKNOWN` | No seeded-defect harness or nonzero output observed |
| Browser/device/external editor proof | `UNKNOWN` | Out of scope and unobserved |

The requested launch receipt
`.omx/ultragoal/launch-20260811T055700Z-g131/launch-receipt.json` is absent
from this worker checkout. The canonical receipt path was inspected outside
the checkout; it records the producer tips but no worker consuming-surface
receipt.

## Acceptance boundary

The gap remains open. Do not promote generic document-history tests,
`paintMask` source inspection, or offline model tests to mask-stroke undo
evidence. Acceptance requires a named mask-stroke scenario, a seeded defect
that fails before the fix, nonzero before/after outputs, exact runtime and
commit identity, and a consuming editor receipt showing undo and redo effects.
