# Task 4 — Source Resolver + Fetch Policy

## Implementation Summary

Created `packages/core/src/linked-images/resolver.ts` — the source-resolution layer for linked images.

## Policies Implemented

| Policy                  | Value                                        | Notes                                       |
| ----------------------- | -------------------------------------------- | ------------------------------------------- |
| Max retries             | 3                                            | Exponential backoff: 500ms → 1s → 2s        |
| Timeout                 | 10s per attempt                              | AbortController-based                       |
| Content-type validation | `image/*` prefix                             | Rejects non-image responses                 |
| Decode validation       | CanvasKit `MakeImageFromEncoded`             | Returns null for invalid bytes              |
| Debounce                | 500ms                                        | Between repeated resolve calls for same key |
| Status values           | `'loading' \| 'ready' \| 'error' \| 'stale'` | Explicit, no silent failures                |

## Platform Branching

- **Browser**: `fetch()` for http/https URLs. Local file reads throw (not supported).
- **Tauri**: `@tauri-apps/plugin-http` for http/https (bypasses WebView CORS). `@tauri-apps/plugin-fs` for local file paths.
- `IS_TAURI` constant from `@open-pencil/core/constants` gates the branching.

## Public API

- `resolveSource(source, imageKey, graph, ck)` — debounced resolution (500ms)
- `resolveSourceImmediate(source, imageKey, graph, ck)` — no debounce, for manual refresh
- `cancelResolve(imageKey)` — abort in-flight resolve
- `getResolveStatus(imageKey)` — check if resolve is `'pending'`
- `validateImageDecode(ck, bytes)` — CanvasKit decode validation
- `inferContentTypeFromPath(filePath)` — MIME from extension for local files

## Renderer Contract Preserved

- `fills.ts` contains **zero** fetch/path logic — only `applyImageFill` consuming `graph.images`
- Evidence: `grep "applyImageFill\|fetch\|readFile" fills.ts | grep -v import` returns only the `applyImageFill` function declaration and its call site
- Resolver writes bytes into `graph.images.set(imageKey, bytes)` — same path the renderer already uses

## Files Modified

- `packages/core/src/linked-images/resolver.ts` — **new**
- `packages/core/src/linked-images/index.ts` — updated barrel exports

## Evidence

- `.sisyphus/evidence/open-pencil-linked-images/task-4-url-resolution.txt` — resolver symbols present
- `.sisyphus/evidence/open-pencil-linked-images/task-4-broken-source.txt` — fills.ts has no fetch/readFile leakage
