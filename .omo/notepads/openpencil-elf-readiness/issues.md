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
