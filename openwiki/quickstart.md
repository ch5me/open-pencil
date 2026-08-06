---
type: wiki-entrypoint
title: OpenPencil Wiki Quickstart
description: 'A source-grounded map for changing OpenPencil: the interactive editor, reusable packages, hosted API, agent surfaces, tests, configuration, and release workflows.'
tags: [quickstart, navigation, operations]
---

# OpenPencil Wiki Quickstart

OpenPencil is a Vue 3 + CanvasKit design editor that opens `.fig` and `.pen` files, runs in browser or Tauri, and ships reusable headless packages, a CLI, MCP server, DOM/CSS importer, and Vue SDK. The root app is in `src/`; semantic document/editor ownership is in `packages/core`; `api/` is optional hosted infrastructure. This wiki is independent of the user-facing `README.md`; canonical implementation entrypoints and tests are linked below.

## Map

- [Architecture overview](architecture/overview.md) — repository boundary and module graph.
- [Editor runtime](architecture/editor-runtime.md) — `src/main.ts`, `App.vue`, router, tabs, and stores.
- [Editor UI](architecture/editor-ui.md) — canvas, panels, commands, editing modes, and responsive shell.
- [Document lifecycle](architecture/document-lifecycle.md) — local/hosted source state, save, autosave, reload, and assets.
- [Documents and formats](architecture/documents-and-formats.md) — `SceneGraph`, `IORegistry`, format adapters, exports, and round trips.
- [Hosted API](architecture/hosted-api.md) — Worker routes, auth, D1/R2, and Durable Objects.
- [Collaboration](architecture/collaboration.md) — Yjs, P2P rooms, hosted rooms, awareness, and persistence.
- [AI and automation](architecture/ai-and-automation.md) — core tools, built-in AI, ACP, browser RPC, and MCP.
- [Configuration](operations/configuration.md) — flags, environment stages, bindings, runtime state, and secret topology.
- [Quality and release](operations/quality-and-release.md) — exact checks, CI, package/Tauri release, deployment, and rollback.
- [Sharp edges](operations/sharp-edges.md) — invariants and failure modes to check before editing.

## Package map

- [`@open-pencil/core`](packages/core.md) — canonical SceneGraph/editor, rendering, layout, IO, tools, RPC, and lint; domain pages cover [editor](packages/core/scene-graph-editor.md), [rendering/text](packages/core/rendering-text.md), [layout/vector](packages/core/layout-vector.md), [Figma API](packages/core/figma-api.md), and [IO/tools](packages/core/io-and-tools.md).
- [`@open-pencil/kiwi` and `@open-pencil/fig`](packages/kiwi-and-fig.md) — low-level Kiwi protocol/container and current Fig package boundary.
- [`@open-pencil/dom-css`](packages/dom-css.md) — browser/headless HTML/CSS/Tailwind projection.
- [`@open-pencil/cli`](packages/cli.md) — `openpencil` file and app command surface.
- [`@open-pencil/mcp`](packages/mcp.md) — stdio/HTTP agent server and app bridge.
- [`@open-pencil/vue`](packages/vue.md) — headless Vue SDK.
- [`@open-pencil/docs`](packages/docs.md) — VitePress public documentation.

## Task routing

| Intent | Canonical page | Entrypoints/symbols | Focused checks | Minimal validation |
|---|---|---|---|---|
| Change editor behavior/history | [Core editor](packages/core/scene-graph-editor.md), [UI](architecture/editor-ui.md) | `createEditor`, `EditorContext`, `EditorStore`, `src/app/shell/keyboard/registry.ts` | `tests/engine/scene-graph/undo/*`, relevant E2E | `bun run test:unit` |
| Change a panel/canvas interaction | [Editor UI](architecture/editor-ui.md) | `EditorCanvas.vue`, `PropertiesPanel.vue`, toolbar actions | editor/text/auto-layout E2E | `bun run test` with a project/spec filter |
| Add or alter `.fig`/export behavior | [Documents/formats](architecture/documents-and-formats.md), [Kiwi/Fig](packages/kiwi-and-fig.md) | `IORegistry`, `BUILTIN_IO_FORMATS`, `exportFigFile`, `parseFigFile` | `tests/engine/io/fig/*`, subgraph tests | `bun run test:unit` |
| Change local/hosted save or autosave | [Document lifecycle](architecture/document-lifecycle.md) | `backend.ts`, `local-backend.ts`, `hosted-backend.ts`, autosave/watch | backend contract, autosave, document-backend E2E | `bun run test:unit` |
| Change hosted API/storage/auth | [Hosted API](architecture/hosted-api.md), [Configuration](operations/configuration.md) | `api/src/worker.ts`, `api/src/index.ts`, documents, `DocumentRoomDO` | `cd api && bun test`, hosted proofs | `bun run proof:all` |
| Add collaboration behavior | [Collaboration](architecture/collaboration.md) | `src/app/collab/use.ts`, `session.ts`, Yjs maps/awareness | hosted-collab E2E | `bun run proof:hosted` |
| Add a shared AI/MCP operation | [AI and automation](architecture/ai-and-automation.md), [Core IO/tools](packages/core/io-and-tools.md) | `defineTool`, `ALL_TOOLS`, `toolsToAI`, MCP registration | registry, AI adapter, MCP tests | `bun run test:unit` |
| Add CLI behavior | [CLI](packages/cli.md) | `packages/cli/src/main.ts`, command module, `format.ts` | package smoke and command tests | `bun --filter @open-pencil/cli build` |
| Change HTML/CSS/JSX/Tailwind mapping | [DOM CSS](packages/dom-css.md) | runtime, conversion, serialization, JSX runtime | package DOM/CSS tests, browser runtime E2E | `cd packages/dom-css && bun run check` |
| Change SDK public API | [Vue SDK](packages/vue.md) | `packages/vue/src/index.ts`, composables/primitives | Vue engine tests, package smoke | `bun run check:vue` |
| Change dev/runtime topology | [Configuration](operations/configuration.md) | `vite.config.ts`, `pitchfork.toml`, flags, Tauri config | flag, alias, automation tests | `bun run proof:flags` |
| Change release/deployment | [Quality and release](operations/quality-and-release.md) | `.forgejo/workflows`, `scripts/promote.mjs`, `build-candidate.mjs` | CI-equivalent checks and hosted proof | `bun run check` |

## Commands

```sh
bun install --frozen-lockfile
bun run svc:ensure       # managed app + docs services
bun run check            # broad static/architecture/package gates
bun run test:unit        # engine tests
bun run test             # Playwright E2E
bun run build            # packages + lint + Vite build
bun run docs:build
bun run proof:preview     # preview deployment proof when URL variables are set
bun run test:coverage
bun run tauri dev
bun run release:candidate
```

The app service is defined in `pitchfork.toml`; use `ch5-svc status`/the repository's service front door rather than guessing ports. Do not read or reproduce secret values. CI workflow details live in `.forgejo/workflows/ci.yml`, `api.yml`, `app.yml`, `preview.yml`, `docs.yml`, `build.yml`, and `promote-production.yml`; the operations page summarizes the commands while those files remain the trigger/source of truth. For a backlog item, this initialization is source-grounded and covers the manifest-backed app, API, packages, docs, tests, operations, and release surfaces; no substantive area was deferred.
