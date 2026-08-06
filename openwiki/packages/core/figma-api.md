---
type: core-domain
title: Figma API Compatibility Layer
description: 'Core exposes a Figma Plugin API-compatible surface backed by SceneGraph nodes and hidden Symbol state, allowing CLI eval, AI tools, and integrations to share one execution target.'
tags: [core, figma-api, compatibility]
---

# Figma API Compatibility Layer

`packages/core/src/figma-api/` implements `FigmaAPI` and `FigmaNodeProxy`. It maps Figma-style node/document/page operations to the SceneGraph and keeps internal editor state behind Symbols. Core tools execute against this API, and CLI `eval` uses it as its scripting target.

Compatibility is an adapter boundary, not a promise that every Figma feature exists. Serialization and node proxy behavior must preserve graph identity, parent/child relationships, component/instance references, variables, and supported style values. New API methods require an export update, a mapping implementation, and the narrowest compatibility test.

Focused evidence includes `tests/engine/figma/api/serialization.test.ts`, Figma API tests under `tests/engine/figma/`, and CLI eval command tests. The API must remain usable headlessly; do not introduce DOM or CanvasKit requirements into the compatibility layer.
