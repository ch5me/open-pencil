---
type: package-architecture
title: Headless Vue SDK
description: '@open-pencil/vue is the curated Vue-facing SDK over core editor state: context, canvas/input, selection, commands, property controls, variables, and headless primitives for custom editor shells.'
tags: [vue, sdk, packages, extension]
---

# Headless Vue SDK

The only public package entry is `packages/vue/src/index.ts`. It exports `provideEditor`/`useEditor`, canvas and input composables, selection/commands/menu helpers, property controls, variable/picker helpers, headless primitives, test IDs, and i18n utilities. `packages/vue/ARCHITECTURE.md` groups these into canvas, controls, editor, primitives, variables, and internal helpers.

The SDK is styling-neutral and headless; consumers own product UI. Vue and core are peer dependencies, CanvasKit is optional at package level but normally required for rendering. The root app is the main consumer (`src/components/EditorCanvas.vue`, layers, pages, properties, menus) and must import the public `@open-pencil/vue` path, not `#vue/*` internals.

Build with `bun --filter @open-pencil/vue build`; validate with `bun run check:vue` and `bun run test:packages`. Changes to `src/index.ts` are high-impact because the curated surface is broad.
