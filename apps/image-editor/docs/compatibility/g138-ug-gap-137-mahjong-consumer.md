# G138 / UG-GAP-137 Mahjong Consumer Evidence

Status: `PARTIAL`

Scope: PSD warning completeness and the external-corpus proof boundary in the
OpenPencil image-editor app.

## Observed consumer behavior

- The deterministic warning corpus exercises corrupt-layer import and lossy
  export features.
- The consumer emits all ten expected structured warning codes, covering
  approximated/skipped import features, corrupt isolation, and lossy export.
- The seeded defect removes `mask-flattened`. The same completeness function
  reports `FAIL`, proving omitted warning coverage is detected.
- The corpus contract is pinned by SHA-256. Its two synthetic consumer scenarios
  are not substituted for external application files.

## Measurement result

| Signal | Result | Evidence |
|---|---|---|
| Warning scenarios | `2` | Corrupt-layer import and lossy-feature export |
| Structured outputs | `10` | Every currently emitted warning code |
| Warning completeness | `PASS` | Expected and observed code sets match exactly |
| Seeded-defect failure | `PASS` | One omitted required warning produces `FAIL` |
| Corpus contract hash | `147f36bff4acb8a27f9f3bd3500241c85a58971fe54f0be7bfba003f49e37b3a` | `psd-warning-corpus-v1.json` |
| External PSD binary corpus | `UNKNOWN` | Zero Photoshop, Affinity Photo, Krita, or Photopea files present |
| Focused consumer spec | `PASS` | 1 file, 3 tests |
| Related consumer suite | `PASS` | 11 files, 52 tests |
| Modified-file lint | `PASS` | Warning completeness spec |
| App typecheck | `FAIL` | Existing `CompositeBlendMode` error in `three-compositor.ts` |
| Spike typecheck | `FAIL` | Existing missing Node/React/Vite type installations |
| Browser/runtime editor effect | `UNKNOWN` | No served editor import/export run |
| Physical device effect | `UNKNOWN` | No named iOS Safari or Android Chrome run |
| External editor effect | `UNKNOWN` | No named external application reopen |

## Identity

- Mahjong launch/source baseline:
  `863a7f615bad0c90e6227c04cdac1fa5d5082558`.
- Runtime: Node `v26.5.0`, npm `11.17.0`.
- Consumed `@open-pencil/core`: `0.13.2`, package producer commit
  `0e9de0c5f91d550f5f2808ad816d0267a15dc173`, integrity
  `sha512-/EIOMDUlpWtTneuwMj7DQfz39i6pOnPlQB5UIOIiEZZ2TLZIiRkKQQVeAsMjs3aFbyA/oYmc1pRhC8PEAl6Kow==`.
- G138 source tips: OpenPencil
  `ccbaa46599e2d497ffde00371ec4c38026392a2f`, ch5-packages
  `7d5b0255c239cc0c542a1ab7de49f013ec4cffe0`, Mahjong
  `863a7f615bad0c90e6227c04cdac1fa5d5082558`.
- Immutable launch receipt:
  `.omx/ultragoal/launch-20260811T080553Z-r176/launch-receipt.json`, SHA-256
  `d013bf4d49833881db8d9a9cac60a0922023fc6e202dfa63a2da86e67de39bca`.

## Acceptance boundary

Consumer warning completeness, nonzero PSD output, and seeded-defect detection
pass with nonzero scenarios and outputs. The hashed artifact is a synthetic
consumer corpus contract, not an external PSD binary corpus. Browser,
physical-device, and external-editor effects remain typed `UNKNOWN` until named
consuming surfaces are observed. Full typechecks remain blocked by existing
errors outside this write set.
