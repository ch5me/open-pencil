# Standalone Image Editor

Status: active OpenPencil product spike. Photoshop-like workflow; no Adobe
source, assets, or private behavior copied.

## Ownership

OpenPencil owns this React application, its document and persistence models,
PSD adapter, GPU compositor, browser proof, and backlog. Mahjong owns none of
these surfaces.

`@ch5me/ch5-ui-web` remains the owner of the shared `SortableTree` component.
The editor consumes that published package through its focused entrypoint.

## Current Slice

The React surface provides a professional shell, nested layer reorder,
thumbnails, rename, duplicate, delete, lock, isolated groups, image, text,
shape, adjustment layers, raster assets, editable masks, clipping, pan, zoom,
move, resize, rotate, keyboard transforms, bounded history, filters, archive
save/load, and PSD import/export through `ag-psd` with structured loss
warnings.

GPU composition uses WebGPU or WebGL2 through Three.js. Canvas 2D takes over
after terminal renderer or context loss. Current deliberate limits include
three blend modes, rasterized PSD text and shapes, flattened imported PSD text,
and no smart objects, vector-path editing, CMYK, 16-bit PSD, or
Photoshop-specific effects.

## Boundaries

React owns commands, history, selection, tools, panels, persistence, and
accessibility. `ThreeCompositor` owns flat ordered GPU composition only.

Tree order is visual top-to-bottom. Renderer flattening converts that to the
compositor's bottom-to-top order. Groups never reach `ThreeCompositor`;
flattening resolves inherited visibility, opacity, clipping, masks, and group
order first.

Raster pixels stay outside command snapshots. Commands store document metadata
and stable asset IDs. The asset registry owns canvases, decoded images,
thumbnails, and generated masks.

PSD remains an adapter rather than the internal model. Unsupported import or
export features return structured warnings. Never claim lossless PSD parity.

## Runtime

- App: `apps/image-editor`
- Start: `ch5-svc up image-editor`
- Typecheck: `bun --filter @open-pencil/image-editor typecheck`
- Model tests: `bun --filter @open-pencil/image-editor test`
- Build: `bun --filter @open-pencil/image-editor build`
- Browser proof: `bun --filter @open-pencil/image-editor test:e2e`
- Pixel parity: `bun --filter @open-pencil/image-editor verify:parity`
- Soak: `bun --filter @open-pencil/image-editor verify:soak`

DOM-simulated component tests are intentionally absent. Model behavior stays in
pure Node tests; integrated UI, persistence, input, renderer, and accessibility
behavior belongs in the served browser proof.

The GPU and PSD engines remain separate build chunks. Physical-device,
external-editor, long-session, and low-end GPU claims remain `UNKNOWN` until
directly observed on identified consuming surfaces.
