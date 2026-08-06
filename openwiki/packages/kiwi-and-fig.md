---
type: package-boundary
title: Kiwi and Fig Package Boundary
description: '@open-pencil/kiwi owns low-level Kiwi schema, codec, GUID, compression, and .fig container protocol; @open-pencil/fig currently exposes container APIs only, while semantic SceneGraph .fig read/write remains in core.'
tags: [kiwi, fig, packages, formats]
---

# Kiwi and Fig Package Boundary

`@open-pencil/kiwi` is scene-graph agnostic. Its `schema-runtime` compiles/parses binary schemas; `fig/container.ts` parses and builds the `fig-kiwi` envelope; `fig/codec.ts` handles Figma messages, compression, schema bytes, and variable-bound paint encoding. Public subpaths are defined in `packages/kiwi/package.json`.

`@open-pencil/fig` currently wraps Kiwi container bytes with `readFigContainer()` and `writeFigContainer()`, retains source bytes/filename, and intentionally throws from `assertFigPackageReady()` to prevent consumers assuming a high-level graph API. Use `@open-pencil/core` for SceneGraph `.fig` import/export. Its status is tested in `packages/fig/tests/index.test.ts`.

Do not move semantic conversion casually: core owns node-change import/export, schema preservation, GUID collision avoidance, and graph metadata. Kiwi tests cover containers, codec initialization, message peeking, and variable bindings. Run `bun --filter @open-pencil/kiwi check` and `bun --filter @open-pencil/fig check`.
