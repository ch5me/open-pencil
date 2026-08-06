---
type: package-architecture
title: Core Package Architecture
description: '@open-pencil/core owns the canonical SceneGraph, editor actions, rendering, layout, document IO, Figma API compatibility, tools, and lint surfaces used by every higher-level adapter.'
tags: [core, package, scene-graph]
---

# Core Package Architecture

`@open-pencil/core` is the semantic center of the repository. It has no DOM dependency and is designed to run headlessly in Bun. Its public export map in `packages/core/package.json` provides targeted subpaths so consumers can avoid unrelated heavy dependencies; the root barrel remains for compatibility.

Read the domain pages for change routing: [scene graph and editor](core/scene-graph-editor.md), [rendering and text](core/rendering-text.md), [layout and vector](core/layout-vector.md), [Figma API](core/figma-api.md), and [IO/tools](core/io-and-tools.md). `@open-pencil/vue`, CLI, MCP, and the root app should consume public exports rather than package-private aliases.

Core's CanvasKit rule is strict: only `packages/core/src/canvaskit.ts` performs the runtime `canvaskit-wasm` import; other modules accept CanvasKit instances as parameters and use type-only imports. This keeps headless and browser paths separable.

Build with `bun --filter @open-pencil/core build`; repository unit coverage lives under `tests/engine`, not beside the core source.
