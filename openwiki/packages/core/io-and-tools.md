---
type: core-domain
title: Core IO, Tools, RPC, and Lint
description: 'Core registers format adapters, exposes framework-agnostic ToolDef operations, provides CLI RPC commands, and owns design lint rules; adapters translate these contracts for CLI, AI, MCP, and the app.'
tags: [core, io, tools, rpc, lint]
---

# Core IO, Tools, RPC, and Lint

`packages/core/src/io/registry.ts` dispatches the adapter contract documented in [documents and formats](../../architecture/documents-and-formats.md). `packages/core/src/tools/schema.ts` defines `ToolDef` and `defineTool`; domain files split read, create, modify, structure, variables, vector, and analysis operations; `registry.ts` assembles `ALL_TOOLS`. A new shared tool requires both definition and registration.

`toolsToAI()` produces provider wrappers; MCP registers the same tool set with Zod schemas and adds transport-specific management/file tools. CLI commands are custom surfaces with `agentfmt` output and are not generated from ToolDefs; CLI `eval` is the bridge to all Figma API operations. `packages/core/src/rpc/` owns commands for the running app.

`packages/core/src/lint/` owns rules and presets used by CLI lint. Keep file access and security policy in adapters: core tools should remain graph/API oriented. Focused tests include `tests/engine/tools/registry.test.ts`, AI adapter tests, RPC tests, lint tests, and IO round-trip suites.
