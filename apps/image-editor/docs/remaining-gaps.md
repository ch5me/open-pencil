# Image Editor Remaining Gaps

Status: prioritized OpenPencil backlog, refreshed August 18, 2026.

The standalone spike is functional. It is not Photoshop-equivalent,
production-mobile-ready, or lossless-PSD-compatible.

## P0: Correctness And Data Safety

- Make raster and mask mutations fully command-backed so undo and redo restore
  pixels, duplicated masks are independent, and unused assets are collected.
- Validate every persisted asset reference and reject hostile archives before
  decode or large allocation.
- Define one exact CPU, WebGPU, and WebGL2 composition contract for nested
  groups, masks, clipping, opacity, rotation, and adjustments.
- Add cancellation, worker decode, progressive opening, and device-aware memory
  budgets for compressed or oversized files.

## P1: Layer And Editing Model

- Add pass-through groups, group and adjustment masks, richer blend modes,
  linked masks, layer effects, smart objects, and non-destructive effect
  stacks.
- Add professional mask controls, brush dynamics, selections, raster painting,
  retouching, gradients, paths, and vector editing.
- Complete transforms with side handles, aspect locking, numeric geometry,
  snapping, guides, rulers, grids, align/distribute, skew, perspective, warp,
  crop, canvas resize, and image resize.
- Complete text, shape, and image property editors without flattening editable
  semantics.

## P1: Application And Mobile

- Replace native drag behavior with proven pointer and touch reorder.
- Prove pinch zoom, two-finger pan, palm rejection, stylus pressure, and
  finger-sized transforms on identified iOS hardware.
- Implement real File, Edit, Layer, and View commands, multiple documents,
  dirty-state close protection, configurable panels, command search, shortcuts,
  and complete context menus.
- Complete keyboard-only, screen-reader, forced-colors, high-contrast, focus,
  and reduced-motion proof.

## P1: PSD And Color Fidelity

- Add representative Photoshop, Affinity, Krita, and Photopea fixtures.
- Prove exported files reopen with expected hierarchy and appearance in named
  external editors.
- Add editable text, vectors, paths, effects, smart objects, channels, ICC
  profiles, DPI, CMYK, 16-bit documents, and PSB only behind explicit contracts
  and fixtures.
- Never claim lossless PSD round-trip before those gates pass.

## P2: Performance And Resilience

- Track texture revisions and dirty rectangles; avoid full source, mask, group,
  and blur rerasterization.
- Add tiling, mipmaps, proxy previews, GPU filter fusion, explicit texture
  budgets, and measured 100-layer and 512-layer benchmarks.
- Move decode, encode, archive, PSD, thumbnails, and CPU composition off the
  main thread where profiling proves pressure.
- Recreate GPU resources after context or device loss; add low-memory mode,
  timeouts, corrupted-image isolation, and long-session leak proof.
- Split or replace Three.js only if measured startup or bundle budgets require
  it; keep the current lazy chunk until then.

## Final Verification Gates

- Current Chrome, Firefox, and Safari browser proof on identified versions.
- Named physical iPhone and iPad proof; Android remains deferred until required.
- Low-end GPU, orientation, thermal, memory-pressure, background/foreground,
  repeated mount/destroy, resize/DPR, and long-session matrix.
- External PSD reopen and appearance checks.
- Bundle, startup, frame-time, texture-memory, and heap budgets with committed
  artifacts.
- Clean OpenPencil service proof through `ch5-svc`; all unobserved surfaces stay
  `UNKNOWN`.
