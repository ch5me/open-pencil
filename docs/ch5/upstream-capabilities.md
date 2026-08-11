# CH5 capability inventory

This is the intent inventory for rebuilding CH5's private OpenPencil fork on a
current upstream tree. It is not a claim that every fork-only commit must
survive.

Measured August 11, 2026:

- Common ancestor: `ec31ea11865fa239b03aa739e8d37f903a252a10`
- Private main inspected: `bb3d2c294767380747141412214621c1ffb3ab7a`
- Upstream inspected: `9ceb7a7bea2ff63d18dacf28a9747b83100113e7`
- Fork-only history: more than 700 commits, including generated checkpoints
- Deliberate non-checkpoint subjects reviewed: 430
- Current tree delta: roughly 1,800 files

The fork is not thin today. The maintained result should become thin by
preserving capabilities, not historical implementation shape.

## Replay decisions

| Capability | Current CH5 surface | Replay decision | Required proof |
| --- | --- | --- | --- |
| Fork provenance and read-only upstream | `AGENTS.md`, README, remote policy | Preserve | Upstream push URL remains disabled; attribution remains explicit |
| CH5 build, Hush, Forgejo, Cloudflare, Grove, and dev services | `.ch5`, `.forgejo`, `.hush`, deployment scripts, `pitchfork.toml` | Preserve additively | Local gates; private CI syntax; staging remains separate from production |
| ELF hosted authentication | `api/src/auth.ts`, login/callback views, hosted session client | Recreate on upstream router/app seams | RS256/JWKS tests; unauthenticated route gate; callback/session tests |
| Hosted documents, assets, and collaboration rooms | `api/src/documents`, document backends, hosted collaboration tests | Recreate through adapters | CRUD, ownership, room derivation, persistence, and browser collaboration tests |
| Firefly runtime and billing authority | Hosted topology, AI/runtime adapters, proof scripts | Recreate only at authority boundaries | Typed failure; exact runtime identity; no local LLM fallback |
| Image editor, PSD import, persistence, and layer model | Large additions under core editor/canvas/IO plus tests | Preserve as a separate CH5 product program, not a blind fork replay | Capability-by-capability tests and explicit upstream-equivalence review |
| CLI review receipts and implementation provenance | CLI additive modules and review tests | Recreate against upstream CLI APIs | Machine-readable receipt and Git-lock-free tests |
| MCP/automation targeting | MCP sessions, stdio bridge, live document/page targeting | Re-evaluate against upstream v0.14 APIs | MCP path scoping, session, and target-selection tests |
| UI/editor fixes and performance work | App shell, menu, layer tree, input coalescing, canvas recovery | Re-evaluate test-first | Port only failures still reproducible on upstream |
| Core/scene-graph/Kiwi/package refactors | Hundreds of edits in upstream-owned packages | Drop historical shape; use upstream v0.14 topology | Upstream package build plus focused CH5 contract tests |
| Generated OpenWiki, authority receipts, benchmark records | `openwiki`, `docs/image-editor` evidence | Regenerate after code decisions | Evidence points at the replay candidate, not old private main |

## Port order

1. Start with upstream's package graph, lockfile, source, tests, and desktop
   configuration.
2. Seed only additive CH5 operations and hosted API files.
3. Recreate hosted flags, routing, auth, document backend, and collaboration
   seams against upstream's current app architecture.
4. Run hosted contract tests before any product-extension replay.
5. Treat the image-editor/PSD/storage body as its own bounded program. Port one
   capability and its tests at a time.
6. Re-run old CH5 regression tests against upstream before porting their
   implementation. A passing test means the old patch is obsolete.
7. Regenerate docs and evidence last.

## Thin-fork target

After reconciliation, every surviving edit to an upstream-owned file needs one
row in `docs/ch5/upstream-drift.md`. Additive CH5 directories do not need
per-file rows, but their public integration seams do.
