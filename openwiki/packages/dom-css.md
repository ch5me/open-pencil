---
type: package-architecture
title: DOM CSS and Tailwind Package
description: '@open-pencil/dom-css projects HTML, CSS, JSX, and Tailwind into DesignDOM and SceneGraph representations and serializes designs back to HTML. Browser and headless runtimes are separate fidelity boundaries.'
tags: [dom-css, html, css, tailwind]
---

# DOM CSS and Tailwind

Public exports in `packages/dom-css/package.json` include `.`, `/browser`, `/jsx-runtime`, and `/jsx-dev-runtime`. `src/index.ts` exports `DesignDocument` types, `htmlToDesignDocument`, `htmlToSceneGraph`, `sceneGraphToDesignDocument`, `serializeHTML`, CSS runtimes, Tailwind compilation, and JSX helpers. The CLI uses the headless runtime; the app imports `/browser`.

Browser runtime uses native DOM/CSSOM and `getComputedStyle()`. Headless runtime uses `parse5` and `@acemir/cssom`, so browser behavior is the fidelity oracle and headless mapping is approximate. External image URLs remain metadata and are not fetched. Unsupported mappings include complex gradients/filters, pseudo-elements, media-query provenance, and some shorthand/calc behavior.

Do not add ad hoc CSS regex parsing; extend the maintained parser/runtime boundary. Focused tests are package tests plus `tests/engine/dom-css/*` and browser-runtime E2E tests. Run `cd packages/dom-css && bun run check`.
