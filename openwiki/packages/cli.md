---
type: package-architecture
title: OpenPencil CLI
description: '@open-pencil/cli publishes the openpencil binary for headless document inspection, conversion, import/export, linting, analysis, XPath queries, Figma API eval, and RPC control of a running app.'
tags: [cli, packages, automation]
---

# OpenPencil CLI

The published binary is `packages/cli/bin/openpencil.js`; source bootstraps at `src/index.ts` and registers commands in `src/main.ts`: analyze, convert, documents, eval, export, import, find, formats, info, lint, query, node, pages, selection, tree, and variables. `src/headless.ts` creates `IORegistry(BUILTIN_IO_FORMATS)`, reads bytes, then calls `computeAllLayouts`.

File mode and app mode differ. `packages/cli/src/app-client.ts:isAppMode` selects app mode when the file argument is absent; `getAppToken()` probes the local app health/session, obtains the automation token, and `rpc()` sends the command to the local RPC endpoint, retrying once after an unauthorized response. The app path depends on the running editor having an open document and reports connection/health failures rather than silently falling back to a file. `requireFile()` rejects commands that need a path. The browser automation bridge listens on `AUTOMATION_WS_PORT` (7601 in the desktop/MCP topology) and MCP HTTP defaults to 7600; token injection is defined by the Vite automation plugin and app bridge. Command modules delegate headless work to `@open-pencil/core` `IORegistry`, layout, Figma API, lint, and analysis exports, or delegate app mode to core RPC commands.

File export supports raster/SVG/PDF/JSX/HTML/FIG; app mode uses RPC for canvas exports and rejects formats requiring local graph serialization. `--page` and `--node` are mutually exclusive. HTML import/export uses `@open-pencil/dom-css`. All output goes through `packages/cli/src/format.ts`/agentfmt and every command supports `--json`. Focused CLI execution and RPC tests live under `tests/engine/cli`; package smoke also invokes binary `--help`.

Commands: `bun run open-pencil --help`, `bun --filter @open-pencil/cli build`, `openpencil tree design.fig`, `openpencil export design.fig -f jsx`, and `openpencil eval design.fig -c "figma.currentPage.name"`. Package smoke coverage is `scripts/smoke-packages.ts`.
