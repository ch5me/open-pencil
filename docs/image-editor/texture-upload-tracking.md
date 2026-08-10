# Texture Upload Tracking

`createImageRenderAdapter()` reports upload work per texture in each returned
`ImageRenderFrame`:

- `uploaded: true` means the adapter had no matching cached revision, or the
  asset was explicitly invalidated with `markDirty(assetId)`.
- `uploaded: false` means the cached asset revision was reused. Unchanged
  layers therefore produce zero texture uploads.
- Revision identity is authoritative. A source or mask mutation must resolve
  to a new asset revision and invalidate only that asset; unrelated textures
  remain reusable.

This contract proves deterministic cache decisions only. It does not prove
Skia, WebGPU, WebGL, or device upload behavior. External renderer and device
parity remains `UNKNOWN` until observed on those consuming surfaces.
