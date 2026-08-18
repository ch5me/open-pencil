# G139 / UG-GAP-138 Texture And GPU Restoration Proof

Status: `PASS_WITH_TYPED_UNKNOWNS`

## Producer model proof

OpenPencil `origin/main` at
`6554d39fc1eb7be2e4e7366b65a42222aa2d26af` adds
`tests/engine/editor/image-proof-gap138.test.ts`.

- Five scenarios cover initial upload, warm reuse, dirty reupload, context loss,
  and post-restore resource recreation.
- Four texture outputs are observed.
- Seeded adapters that ignore dirtiness or fail to advance resource generation
  both produce `FAIL`.
- The focused texture/render/resilience suite passes 30 tests and 716
  assertions.

## OpenPencil image-editor app proof

The real Chromium parity harness observes the Mahjong Three compositor.

- Initial render uploads three source textures and one mask texture.
- Rendering unchanged layers adds zero texture uploads.
- One source revision adds one source upload and no mask upload.
- One mask revision adds one mask upload and no source upload.
- A seeded unchanged upload is rejected.
- WebGPU and WebGL2 base/reordered readbacks remain within three RGBA8 channel
  values of the CPU oracle; measured maximum delta is `2`.
- Forced WebGL2 context loss emits one failure callback and rejects rendering
  while lost. Restoration advances resource generation to `1`, reuploads all
  four textures, and returns nonzero pixels.

The seeded unchanged-upload defect is rejected. Physical iOS Safari, Android
Chrome, named-device restoration, and long-session stability remain `UNKNOWN`.

## Identity

- OpenPencil `origin/main`:
  `6554d39fc1eb7be2e4e7366b65a42222aa2d26af`
- OpenPencil image-editor app baseline:
  `d854596f20b64dc8981aa5e5b7f8062df118bc17`
- Mahjong implementation:
  `6bd70334e3015c28df063dddbbee6b2b5dd3ee33`
- ch5-packages `origin/main`:
  `fc6a2697b4a06dcdb9ed5faeeb7629720a5fff00`
- Runtime: Node `v26.5.0`, npm `11.17.0`, Playwright Chromium
  `145.0.7632.6`, Darwin arm64.
- Compositor: `compositor-package-v1`, `three-compositor-v1`, Three `0.185.1`.
- Consumed `@open-pencil/core`: `0.13.2`, integrity
  `sha512-/EIOMDUlpWtTneuwMj7DQfz39i6pOnPlQB5UIOIiEZZ2TLZIiRkKQQVeAsMjs3aFbyA/oYmc1pRhC8PEAl6Kow==`.
- Launch receipt:
  `.omx/ultragoal/launch-20260811T082741Z-r177/launch-receipt.json`
- Receipt SHA-256:
  `2f2874ad4e41fb2c10c6238264fa5ab7a778c97fcb78f021f2ccd7de02d777e0`

## Verification boundary

- App typecheck: `PASS`.
- Modified-file lint: `PASS`.
- Real headless Chromium WebGPU/WebGL2 parity and selective upload proof:
  `PASS_LOCAL`.
- Spike build: `FAIL` from pre-existing missing Node/React/Vite type
  definitions.
- Exact `ch5 test` Vitest routing: `FAIL` because no local Vitest executable is
  available to the adapter.
- Physical device, external renderer/application, memory, and soak proof:
  `UNKNOWN`.
