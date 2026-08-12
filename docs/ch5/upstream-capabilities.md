# CH5 capability inventory

This is the intent inventory for rebuilding CH5's private OpenPencil fork on a
current upstream tree. It is not a claim that every fork-only commit must
survive.

Measured August 12, 2026:

- Common ancestor: `ec31ea11865fa239b03aa739e8d37f903a252a10`
- Private main inspected: `237fa465eef2c6f6df7a3753fae2f8089843765d`
- Upstream inspected: `51ab21571ad29cf86e4862e145dcf9e937860390`
- Fork-only history: 725 commits
- Substantive commits: 413
- Agent checkpoints: 191
- Merge commits: 90
- Generated, fixture, or hygiene noise: 31
- Patch-equivalent upstream commits: 126 by `git cherry`
- Current tree delta: 1,779 files

The fork is not thin today. The maintained result should minimize edits to
upstream-owned internals, not minimize CH5 product depth. OpenPencil is an
ELF-authenticated design surface; deep hosted and image-editing capabilities
are intentional. Agent execution stays behind a provider-neutral gateway.

## What CH5 added

- ELF authentication, hosted route gating, session handling, and hosted API
  integration.
- Hosted document, asset, persistence, collaboration-room, and ownership
  services.
- Provider-neutral hosted agent chat with ELF-authenticated admission,
  deterministic local contract execution, and no hosted-to-local fallback.
- Hush, Forgejo, Cloudflare, Grove, Pitchfork, staging, promotion, and release
  operations.
- PSD import, raster composition, image-editor sessions, texture/resource
  planning, and atomic persistence.
- DOM/CSS and Design JSX compatibility, Kiwi and Fig package extraction, Vue
  SDK work, CLI exports and receipts, MCP targeting, and automation.
- Large editor, canvas, scene-graph, layer-tree, input, performance, Figma
  compatibility, and regression-test bodies.

The final four groups contain substantial overlap with upstream v0.14. Preserve
their behavior only when a focused CH5 regression still fails on current
upstream.

## Replay decisions

| Capability                                                    | Current CH5 surface                                                                                            | Replay decision                                                     | Required proof                                                                                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fork provenance and read-only upstream                        | `AGENTS.md`, README, remote policy                                                                             | Preserve                                                            | Upstream push URL remains disabled; attribution remains explicit                                                                                                                 |
| CH5 build, Hush, Forgejo, Cloudflare, Grove, and dev services | `.ch5`, `.forgejo`, `.hush`, deployment scripts, `pitchfork.toml`                                              | Preserve additively                                                 | Local gates; private CI syntax; staging remains separate from production                                                                                                         |
| ELF hosted authentication                                     | `api/src/auth.ts`, login/callback views, hosted session client                                                 | Recreate on upstream router/app seams                               | RS256/JWKS tests; unauthenticated route gate; callback/session tests                                                                                                             |
| Hosted documents, assets, and collaboration rooms             | `api/src/documents`, document backends, hosted collaboration tests                                             | Recreate through adapters                                           | CRUD, ownership, room derivation, persistence, and browser collaboration tests                                                                                                   |
| Provider-neutral hosted agent gateway                         | Additive protocol/client/API modules plus exact upstream edits recorded by path and symbol in the drift ledger | Preserve only these narrow product/API integration surfaces         | Ordered streaming; typed failure; opaque IDs; run cancellation and in-process reconnect; approval/tool continuation; deterministic gateway; no fallback or infrastructure fields |
| Image editor, PSD import, persistence, and layer model        | Large additions under core editor/canvas/IO plus tests                                                         | Preserve as a required CH5 product program, not a blind fork replay | Capability-by-capability tests and explicit upstream-equivalence review                                                                                                          |
| CLI review receipts and implementation provenance             | CLI additive modules and review tests                                                                          | Recreate against upstream CLI APIs                                  | Machine-readable receipt and Git-lock-free tests                                                                                                                                 |
| MCP/automation targeting                                      | MCP sessions, stdio bridge, live document/page targeting                                                       | Re-evaluate against upstream v0.14 APIs                             | MCP path scoping, session, and target-selection tests                                                                                                                            |
| UI/editor fixes and performance work                          | App shell, menu, layer tree, input coalescing, canvas recovery                                                 | Re-evaluate test-first                                              | Port only failures still reproducible on upstream                                                                                                                                |
| Core/scene-graph/Kiwi/package refactors                       | Hundreds of edits in upstream-owned packages                                                                   | Drop historical shape; use upstream v0.14 topology                  | Upstream package build plus focused CH5 contract tests                                                                                                                           |
| Generated OpenWiki, authority receipts, benchmark records     | `openwiki`, `docs/image-editor` evidence                                                                       | Regenerate after code decisions                                     | Evidence points at the replay candidate, not old private main                                                                                                                    |

## Upstream overlap

| Capability                                                   | Upstream status                                                | Policy                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------- |
| DOM/CSS, Design JSX, Kiwi, Fig, Vue SDK                      | Fully or mostly present, often with newer architecture         | Use upstream; retain only failing CH5 contract tests       |
| Layer virtualization and input coalescing                    | Present upstream                                               | Drop old patches unless their focused tests fail           |
| Storage workspace, local-first sync, S3, previews            | Present upstream, but not equivalent to CH5 hosted persistence | Use upstream UI/storage; keep hosted backend as an adapter |
| MCP, CLI, automation                                         | Present but CH5 targeting and provenance differ                | Rebuild only CH5 targeting and receipt contracts           |
| Canvas recovery and resource resilience                      | Partly present                                                 | Re-test each failure; keep only remaining gaps             |
| PSD and image-editor runtime                                 | No equivalent upstream subsystem                               | Separate CH5 product program                               |
| ELF auth, hosted API, agent-gateway boundary, CH5 deployment | No equivalent upstream authority                               | Keep additive and explicit                                 |

## Current replay candidate

The refreshed upstream-first candidate uses private main
`5fb8973d48161cb3dd77c82c7e6359df314acc72` as parent one and upstream
`51ab21571ad29cf86e4862e145dcf9e937860390` as parent two.

Replayed:

- CH5 operations, Hush, Forgejo, Cloudflare deployment, and dev services.
- ELF auth, hosted flags, session, login, callback, and router integration.
- Hosted API document, asset, room, and persistence baseline.
- Core hosted contract and focused auth/API tests.
- Hosted document frontend through upstream storage adapters, tabs, and
  local-first sync.
- Provider-neutral gateway boundary: independent `hostedAgent` selection,
  generic run lifecycle, guarded client-side actions, shared product approval,
  and narrow API/config integration. ELF remains authentication only.
- Strict CLI review receipts and implementation provenance.
- Additive PSD staging/rasterization, image composition/resilience, and atomic
  image-persistence extension APIs with focused regressions.

Not replayed:

- A second private document backend, image store, journal, tab/session model, or
  renderer. Upstream remains authoritative for those concerns.
- Native Photoshop-compatible editable PSD decoding/export. Current PSD support
  is a bounded staged metadata and raster contract.
- User-facing image-editor UI activation. Public extension APIs are present;
  app activation requires a concrete workflow built on upstream editor
  commands, undo, `SceneGraph.images`, renderer, and storage.
- Historical UI/core patches not yet proven necessary.

The candidate is aligned to the inspected `upstream/master`
(`51ab21571ad29cf86e4862e145dcf9e937860390`).

## Port order

1. Start with upstream's package graph, lockfile, source, tests, and desktop
   configuration.
2. Seed only additive CH5 operations and hosted API files.
3. Recreate hosted flags, routing, auth, document backend, and collaboration
   seams against upstream's current app architecture.
4. Reconcile every exact upstream-owned agent path/symbol row in the drift
   ledger and run deterministic gateway contract tests before any
   product-extension replay.
5. Treat image extensions as a bounded program. Keep proven PSD, raster,
   resilience, and persistence primitives additive; do not restore parallel
   product authorities.
6. Re-run old CH5 regression tests against upstream before porting their
   implementation. A passing test means the old patch is obsolete.
7. Regenerate docs and evidence last.

## Thin-fork target

After reconciliation, every surviving edit to an upstream-owned file needs one
row in `docs/ch5/upstream-drift.md`. Additive CH5 directories do not need
per-file rows, but their public integration seams do.

History stays intact through the reconciliation merge. Maintained code does not
preserve the 725-commit implementation sequence. Replay the surviving product as
a small set of capability commits:

1. CH5 operations and deployment.
2. ELF auth and hosted API.
3. Hosted frontend and provider-neutral agent-gateway adapters.
4. CLI and MCP CH5 contracts.
5. PSD/image-editor/persistence as a required CH5 product program.
6. Focused residual regressions that current upstream still fails.
