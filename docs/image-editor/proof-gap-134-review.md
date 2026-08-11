# PROOF-GAP-134 nested-group pixel review

Bounded proof lane for goal `G135-ug-gap-134` / `UG-GAP-134`.

## Gap

The acceptance gap requires a nested-group compositor pixel oracle, nonzero
output, output identity, and typed `UNKNOWN` where a consuming backend is not
available.

## Current contract

`createCompositionPlan()` carries ancestor opacity through nested groups.
`composeRasterRGBA8()` applies that inherited opacity to the resolved raster
revision. The focused proof in
`tests/engine/editor/image-composition-gap134.test.ts` builds an outer clipping
group, an inner group at 50% opacity, and an image at 50% opacity. The red
source pixel must resolve to `[255, 0, 0, 64]` in the one-pixel RGBA8 output.

The test also records a nonzero four-byte published output through
`EvidenceCollector` and verifies unavailable Skia composition remains typed
`UNSUPPORTED` with backend equivalence `UNKNOWN`.

## Evidence boundary

Local nested-group CPU pixel behavior: `PASS`.

- nested ancestor opacity: `PASS`
- exact RGBA8 pixel oracle: `PASS`
- nonzero output receipt: `PASS`
- unavailable backend equivalence: typed `UNKNOWN`

Full seeded-defect acceptance remains `UNKNOWN`. No exact mutation command,
defect diff, failing output, or consuming browser/desktop runtime receipt is
present in this bounded lane. The test proves the current implementation and
its contract; it does not prove WebGL2, WebGPU, Skia, device, or external-editor
pixel parity.

## Verification

```sh
bun test tests/engine/editor/image-composition-gap134.test.ts
```

Result: 2 passed, 0 failed, 5 assertions.
