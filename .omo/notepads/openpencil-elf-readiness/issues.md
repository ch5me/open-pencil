## Task 15 Verification Fixes (2026-05-29)
- `typeof window === 'undefined'` in `hosted.ts` triggered `no-typeof-window-check` rule — replaced with `IS_BROWSER`/`IS_TAURI` from constants
- `require('@/app/hosted/flags')` triggered `no-var-requires` rule — replaced with `await import()` dynamic import
- `beforeEach`/`afterEach` imported from `bun:test` but not used and not exported — removed from test import
- All 6 seam tests pass, oxlint 0 warnings, 0 errors on changed files

## Task 11 Verification Fixes (2026-05-29)
- `tests/unit/hosted-storage.test.ts` imported `mock` from `bun:test` which is not a valid export — replaced with plain function
- Fake `HostedDocumentClient.open()` return did not satisfy `DocumentOpenResult` (missing full `SceneGraph`) — used `satisfies HostedDocumentClient` with `as any` on graph
- `api/src/documents/crud.ts` had unused `snapshotResult` local — removed (R2 put result is fire-and-forget)
- `bun:test` `.rejects.toThrow()` fails with `async () => ...` wrapper — must pass the Promise directly
- All 15 tests now pass (12 api/documents + 3 unit/hosted-storage), zero TypeScript diagnostics on changed files

## Task 11 Asset CRUD Fixes (2026-05-29 continuation)
- `writeAssetToR2()` in storage.ts was dead code — now called by `writeHostedAsset()`
- `deleteHostedDocument()` was not cleaning up R2 asset objects (only snapshots) — added `assetsBucket` param
- `bun:test` does not export `mock` — removed from crud.test.ts imports
- `documentAssetStorageKey` unused import in crud.ts — removed to eliminate hint
- Phase 2 added 4 new asset tests in crud.test.ts (write, write auth rejection, delete, delete not-found)
- All 19 tests now pass (16 api/documents + 3 unit/hosted-storage)
