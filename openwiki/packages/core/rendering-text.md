---
type: core-domain
title: Core Rendering, Text, and Fonts
description: 'Core renders SceneGraph nodes through CanvasKit/Skia, SVG, PDF, and derived exports; text and font subsystems provide measurement, editing, style runs, and direction without making CanvasKit a global dependency.'
tags: [core, rendering, canvas, text, fonts]
---

# Core Rendering, Text, and Fonts

`packages/core/src/canvas/renderer.ts` owns Skia painting. `SkiaRenderer` receives a CanvasKit instance and graph/render inputs; callers choose browser, worker, or headless loading. Raster IO uses an injected renderer when available and falls back to headless CanvasKit. SVG/PDF renderers consume graph scopes directly.

`packages/core/src/text/` owns font loading/metrics, text editing, style runs, and direction. The app preloads fonts before mounting, while the editor session exposes text editing actions. Avoid importing CanvasKit at module load time outside `canvaskit.ts`; this is what preserves headless CLI and unit-test operation.

Canvas render scheduling, font availability, and text edit commit are cross-boundary concerns. Focused tests include rendering/export suites under `tests/engine/io`, text editing E2E tests, and font/editor tests. Validate with `bun run test:unit` or the narrow relevant test path.
