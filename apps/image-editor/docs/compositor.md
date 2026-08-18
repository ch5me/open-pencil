# Three.js WebGPU/WebGL2 Compositor

Status: experimental standalone compositor used by the OpenPencil image-editor
app. No broader OpenPencil renderer migration is authorized.

## Contract

`ThreeCompositor` is framework-free. Its ordered layer contract contains an ID,
sRGB canvas source, opacity, normal/multiply/screen blend mode, optional linear
mask, visibility, optional bounds, rotation, and adjustment values. Array order
is bottom-to-top.

The compositor owns texture upload, two reusable linear RGBA8 ping-pong render
targets, TSL source-over math, backend selection, resize, readback, and cleanup.
The CPU oracle models RGBA8 quantization after every pass. Empty or hidden
stacks produce transparent output. Invalid IDs and reorder lists fail loudly.

The React app dynamically imports the compositor through
`src/editor/runtime-loader.ts`. The loader validates
`three-compositor-v1` before mounting; incompatible chunks fail with
`E_RUNTIME_VERSION_MISMATCH`.

Device loss, WebGL context loss, and renderer errors invoke `onFailure`. Loss
is terminal and later calls fail loudly. Automatic renderer recovery remains
outside the current contract.

## Proof

Focused tests cover ordered CPU fixtures, texture invalidation, group
composition, and failure contracts. Browser scripts cover real Chromium
readback, forced WebGL2, runtime interaction, context loss, accessibility, and
optional soak artifacts.

This does not prove Safari, iOS, Android, background recovery, memory pressure,
or a named physical device. Those claims remain `UNKNOWN`.

## Loading

The app imports public `three/webgpu` and `three/tsl` entrypoints. Vite isolates
Three.js into the `compositor-core` chunk and `ag-psd` into `psd-adapter`.
Use `bun --filter @open-pencil/image-editor measure` for current raw and gzip
sizes; historical measurements are not current acceptance evidence.
