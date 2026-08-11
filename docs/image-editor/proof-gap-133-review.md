# PROOF-GAP-133 clipping-group pixel review

Review lane for goal `G134-ug-gap-133` / `UG-GAP-133`.

## Gap

The acceptance gap requires clipping-base visibility and opacity through a
pass-through group, an exact seeded-defect failure, nonzero output, output
identity, and typed `UNKNOWN` where a backend is unsupported.

## Current contract

`createCompositionPlan()` propagates ancestor visibility and opacity into each
planned node. It also records pass-through isolation and clipping depth.
`composeRasterRGBA8()` skips hidden planned nodes, clips raster pixels against
ancestor bounds, and applies inherited opacity during blending.

The existing focused tests prove:

- a pass-through clipping group is represented in the composition plan
- hidden clipping ancestors suppress descendant pixels
- nested group opacity produces nonzero RGBA8 output
- the render adapter emits clipped composition commands
- unavailable GPU and Skia paths return typed unsupported capabilities with
  equivalence `UNKNOWN`

The visible nested fixture produces `[255, 0, 0, 32, 0, 0, 0, 0]`; the hidden
fixture produces transparent output.

## Evidence boundary

Local contract and CPU pixel behavior: `PASS`.

- clipping-base visibility: `PASS`
- inherited clipping-group opacity: `PASS`
- pass-through plan identity: `PASS`
- nonzero CPU pixel output: `PASS`
- unsupported backend equivalence: typed `UNKNOWN`

Full seeded-defect acceptance remains `UNKNOWN`. This review found no recorded
mutation command, defect diff, failing output, or mutation receipt tied to an
exact source commit. The focused tests prove the current implementation, but
running only the unmodified implementation does not prove that a named seeded
defect was injected and rejected.

Output identity also remains `UNKNOWN` beyond the local test process. No
published artifact or consuming runtime receipt joins the produced pixels to an
exact commit and runtime identity.

## Verification

Local focused command:

```sh
CH5_RAW_TEST_OK=1 bun test tests/engine/editor/composition.test.ts \
  tests/engine/editor/image-render.test.ts \
  tests/engine/editor/image-raster-composition.test.ts
```

Result: 61 passed, 0 failed, 145 assertions.

Not proved:

- exact seeded-defect mutation failure
- browser or desktop consuming pixels
- WebGL2, WebGPU, or Skia pixel parity
- physical-device output
- external-editor interoperability
- artifact-to-commit/runtime output identity

Those surfaces remain `UNKNOWN` until observed directly.
