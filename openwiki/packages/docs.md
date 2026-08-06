---
type: package-architecture
title: Documentation Site
description: '@open-pencil/docs is the private VitePress site for user guides, CLI/MCP references, DOM/CSS mapping, and the Vue SDK; its config also generates LLM-oriented documentation output.'
tags: [docs, vitepress, packages]
---

# Documentation Site

`packages/docs/.vitepress/config.ts` configures VitePress, clean URLs, dark appearance, SEO/locales, and `vitepress-plugin-llms`. English docs are canonical for the generated agent corpus; locale trees mirror portions of the site but are not the primary implementation contract. `sdk-sidebar.ts` manually enumerates SDK pages, so new public symbols need deliberate documentation/sidebar updates.

Key pages are `reference/cli.md`, `programmable/mcp-server.md`, `reference/dom-css-mapping.md`, and `programmable/sdk/`. Build/run with `bun run docs:dev`, `bun run docs:build`, or `bun run docs:preview`; the managed docs service is declared in `pitchfork.toml`.

Docs deployment is separate from app deployment and publishes `packages/docs/.vitepress/dist` through the docs workflow. Avoid treating screenshots, generated LLM files, or translated copies as source architecture.
