# Texture Upload Tracking

`createImageRenderAdapter()` reports deterministic upload decisions per asset in
each returned `ImageRenderFrame`. It does not perform a Skia, WebGL, WebGPU, or
device upload.

- `uploaded: true` means the adapter has no matching cached revision, or the
  asset was explicitly invalidated with `markDirty(assetId)`.
- `uploaded: false` means the cached asset revision was reused. Unchanged
  layers therefore produce zero adapter-reported uploads.
- Shared asset bindings are deduplicated: one texture entry per visible asset,
  while each scene node still emits its own render command.
- A source or mask mutation must resolve to a new immutable asset revision and
  invalidate only that asset; unrelated textures remain reusable.

## Partial updates

The current adapter invalidates and reports whole-asset work. `ImageTexture`
does not carry a dirty rectangle or subresource range, so partial pixel-region
uploads are not implemented or proven. Do not infer partial-update behavior
from `uploaded: true`; keep that capability `UNKNOWN` until a typed region is
carried through the consuming renderer and verified there.

## Revision contract

Revision IDs must be immutable content identities. A resolver must return a
revision whose `revisionId` matches the binding's requested revision ID.
Resolvers that mutate bytes under one ID, or return a different revision ID,
violate this contract and can make `uploaded: false` stale or associate bytes
with the wrong asset revision.

External renderer, performance, and device parity remain `UNKNOWN` until
observed on those consuming surfaces.
