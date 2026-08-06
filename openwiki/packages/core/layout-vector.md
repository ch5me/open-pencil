---
type: core-domain
title: Core Layout, Geometry, and Vector Domains
description: 'Yoga-backed layout computes flex and grid geometry; core geometry, snapping, and vector-network modules provide the coordinate and path primitives consumed by the editor and renderers.'
tags: [core, layout, geometry, vector]
---

# Core Layout, Geometry, and Vector Domains

`packages/core/src/layout/` owns `computeLayout` and layout conversion around the pinned Yoga grid fork. Layout is explicitly recomputed after document load and after mutating AI operations. Geometry utilities define transforms, bounds, hit tests, snapping, and coordinate conversion; vector modules encode/decode paths and perform Bezier/boolean operations.

The app's vector-edit and pen lifecycles sit above these pure domains. Keep geometry and vector code framework-agnostic so it remains usable by CLI, MCP, and headless tests. Auto-layout changes must preserve parent constraints, child ordering, gap/padding, and selection semantics.

Focused tests include nested auto-layout suites under `tests/engine/layout/auto-layout/`, vector tests, snapping/hit-test tests, and `tests/e2e/editor/auto-layout/basic.spec.ts`. Use `bun test <focused-path>` for narrow validation and `bun run test:unit` for the engine suite.
