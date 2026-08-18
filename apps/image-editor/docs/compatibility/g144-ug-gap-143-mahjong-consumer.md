# G144 / UG-GAP-143 Selection And Matting Authorization Audit

Status: `BLOCKED`

Captured at: `2026-08-11T17:16:37Z`

Scope: H2.5 ownership convergence and the accepted ADR, selection/matting
contract, security, memory, archive, fixture, editable-round-trip, and
consuming-workflow gates required before implementation.

## Start gate

Selection or matting implementation may start only after all of these are
accepted and bound to the same current tip set:

1. H2.5 names one production authority, one consuming path, and a
   content-addressed ownership receipt.
2. An accepted ADR names the production owner, migration boundary, compatibility
   adapter, removal trigger, and no-duplicate-authority rule.
3. A versioned contract defines selection modes, coordinate spaces, binary and
   alpha-mask representation, feather/refinement semantics, transform behavior,
   history and persistence behavior, cancellation, and typed unsupported/error
   outcomes.
4. Security and memory limits cover hostile image inputs, decoded dimensions,
   mask/readback allocation, worker ownership, cancellation, and named-device
   peak memory.
5. Archive authority and worker boundaries are accepted. A selection/matting
   result must not bypass the existing document and asset authorities.
6. Current-tip normative fixtures, seeded defects, fuzz coverage, and
   deterministic output tolerances exist for selection and matting.
7. Editable save/reopen preserves selection and mask identity without aliasing
   or history loss.
8. The actual Mahjong consuming workflow emits nonzero output with exact
   renderer/runtime identity. Source or model tests do not substitute for this.

## Cross-repository evidence

| Gate | OpenPencil | Mahjong | ch5-packages | Verdict |
| --- | --- | --- | --- | --- |
| H2.5 selection/matting authority | Generic authority matrix exists; no selection/matting owner and consuming-path receipt observed | Legacy layer selection and raster masks only; no production selection/matting authority | No image-editor selection/matting authority observed | `UNKNOWN` |
| Accepted ADR | Authority matrix is architect-approved for existing image-editor surfaces, but no accepted selection/matting ADR or removal trigger observed | No accepted selection/matting ADR | No relevant image-editor ADR observed | `UNKNOWN` |
| Versioned selection/matting contract | Selection APIs and raster-mask types exist, but no matting contract, refinement semantics, or consumer binding observed | `executeSelection` is a typed capability gap; masks are layer-level compatibility data | No relevant contract observed | `FAIL` |
| Security and memory authorization | Worker protocol and memory admission primitives exist; selection/matting-specific limits and authorization are not proved | Generic archive/PSD limits exist; no selection/matting peak-memory proof | No relevant image-editor proof observed | `PARTIAL` |
| Archive and worker boundary | Existing archive and worker authorities exist; no selection/matting result transaction observed | Existing document/asset persistence and PSD compatibility paths exist | No image-editor archive authority observed | `PARTIAL` |
| Current-tip fixtures and fuzz | Geometry, mask, and worker tests exist; no normative selection/matting corpus observed | PSD warning and composition fixtures are not selection/matting fixtures; no matting fuzz observed | No relevant fixture corpus observed | `FAIL` |
| Editable save/reopen | No selection/matting content round-trip observed | Legacy selected-layer and mask asset metadata round-trip passes; selection/matting content parity is not implemented | No relevant consumer round-trip observed | `PARTIAL` |
| Consuming workflow and renderer identity | No Mahjong consuming effect observed | No selection/matting browser or renderer artifact observed | No consuming artifact observed | `UNKNOWN` |

## Observed local boundaries

- `src/app/model/editor-document.ts:539-560` keeps selection explicitly
  blocked with `E_CAPABILITY_SELECTION_UNAVAILABLE`; no silent approximation
  occurs.
- `src/app/model/editor-document.spec.ts:195-223,256-268` proves typed
  selection failure does not create a history transaction and preserves the
  document through save/reopen.
- `src/app/model/editor-document.spec.ts:489-515` proves stable legacy image
  and mask asset references round-trip. This is metadata proof, not selection
  or matting content proof.
- `src/app/adapters/editor-psd.ts:132-152` imports PSD masks into layer mask
  assets. This is compatibility import, not a selection/matting engine.
- `spikes/three-compositor-react/src/editor/multi-selection-geometry.ts` covers
  pure geometry only. Its unsupported rotation path must not be promoted into a
  broader selection contract.
- `.llm/wiki/image-editor-remaining-gaps.md:58-67,92` records missing
  selection-to-mask, mask-to-selection, marquee, lasso, polygon, magic-wand,
  subject, and background selection.
- OpenPencil authority evidence records generic mask and image authorities, but
  its raster-mask byte lifecycle remains `UNKNOWN`; the observed authority
  matrix hash is `7df61fa8d9fd23438bebbfa86aa053641c48e5f4e041449bb3baf9423d235e3e`.

## Exact missing approvals

- H2.5 selection/matting owner, path allocation, and current-tip hash-bound
  duplicate-authority receipt.
- Accepted ADR with production owner, Mahjong migration boundary, adapter
  removal trigger, and explicit no-parallel-engine decision.
- Versioned selection/matting contract covering all requested modes, mask
  semantics, transforms, history, persistence, cancellation, and typed errors.
- Security/memory authorization with hostile-input limits, decoded-size and
  readback budgets, worker/cancellation ownership, and named-device peak-memory
  evidence.
- Normative current-tip fixture manifest, seeded defect harness, fuzz record,
  and declared output tolerance.
- Editable selection/mask save/reopen proof with independent asset identity and
  undo/redo behavior.
- Fresh Mahjong browser/consuming receipt proving nonzero selection/matting
  output and exact renderer identity.

## Acceptance result

`UG-GAP-143` stays blocked. Do not add a selection or matting implementation,
new mask authority, or compatibility approximation from this audit. Keep the
existing typed `E_CAPABILITY_SELECTION_UNAVAILABLE` behavior until the missing
approvals are accepted and observed.

## Verification boundary

- Source and compatibility inspection: `PASS`.
- Existing typed blocked behavior: `PASS`.
- Existing legacy mask metadata round-trip: `PASS`.
- Selection/matting fixtures, fuzz, editable content round-trip, and consuming
  effect: `UNKNOWN` or `FAIL` as tabulated above.
- Browser, physical-device, external renderer, and named-device memory effects:
  `UNKNOWN`.

Coordination protocol: coordinated - task JSON, OpenPencil authority evidence,
Mahjong compatibility boundaries, fixture/round-trip boundaries, and consuming
effect boundary checked; no implementation surface widened.
