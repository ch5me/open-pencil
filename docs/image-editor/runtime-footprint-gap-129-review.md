# UG-GAP-129 runtime footprint review

Review-and-document lane for goal `G130-ug-gap-129` / `UG-GAP-129`.
The fresh launch receipt is
`.omx/ultragoal/launch-20260811T053300Z-g130/launch-receipt.json`.

## Contract

OpenPencil already owns a typed, framework-neutral contract for this gap:

`packages/core/src/editor/image-footprint/index.ts`

- `ImageRuntimeFootprintContract` is versioned as
  `image-runtime-footprint-v1`.
- `offlineCache` and `runtimeVersionStrategy` are explicit capability fields.
- Both fields default to `UNKNOWN`.
- `validateImageRuntimeFootprintContract()` rejects an invalid version or
  capability state; it does not turn an assertion into runtime evidence.

The focused contract test is
`tests/engine/editor/image-footprint.test.ts`. It proves that explicit
capability values validate and that unmeasured bundle, startup, and loading
values remain `UNKNOWN`.

## Evidence boundary

This lane found no consuming-surface evidence that proves an image-editor
offline cache or a cache/runtime-version migration strategy:

- `src/app/cache/` is a generic cache helper surface, not an image-document
  offline cache with eviction, integrity, migration, or version negotiation.
- `src/app/editor/fonts/cache.ts` versions a downloaded-font cache only; it is
  unrelated to image documents or renderer runtime compatibility.
- `src/app/hosted/flags.ts` caches resolved hosted configuration in memory; this
  is not an offline document cache or runtime-version strategy.
- The image-editor core has no service-worker, IndexedDB image-document cache,
  cache manifest, migration protocol, or runtime compatibility handshake.

Therefore `offlineCache` and `runtimeVersionStrategy` stay `UNKNOWN`. Do not
promote them to `SUPPORTED` from schema presence, generic cache helpers, unit
tests, or source inspection.

## Verification

Local proof can cover contract shape and validation only:

- `image-footprint.test.ts` passes for defaults, explicit values, and invalid
  numeric input.
- Browser/offline, cache migration, runtime upgrade, device, and external
  editor compatibility proof remain `UNKNOWN` unless observed on those exact
  consuming surfaces.

Implementation authority:

```txt
packages/core/src/editor/image-footprint/
tests/engine/editor/image-footprint.test.ts
packages/docs/development/image-runtime-footprint.md
```
