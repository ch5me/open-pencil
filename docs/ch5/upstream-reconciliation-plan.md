# Upstream reconciliation plan

## Goal

Produce one merge commit that records `upstream/master` as integrated while
preserving only deliberate CH5 behavior. Afterward, weekly sync should classify
as `routine` or `review`.

## Why this is a program

The August 12, 2026 inspection found 500 upstream-only commits, 725 fork-only
commits, and a 1,779-file private tree delta. The private history contains 413
substantive commits, 191 agent checkpoints, 90 merges, and 31 generated,
fixture, or hygiene commits. An earlier merge prediction found 953 conflicts.
Resolving that with line-by-line conflict choices would preserve accidental
duplication and make future merges worse.

## History policy

- Preserve the complete private history as parent one of one reconciliation
  merge.
- Preserve exact upstream as parent two.
- Do not rebase, squash, or force-push shared private main.
- Do not replay 725 commits individually.
- Rebuild the maintained tree as a small number of capability commits after
  upstream, grouped by product contract rather than historical agent session.
- Keep old commits for provenance and archaeology, not as the future maintenance
  unit.

The target capability commits are:

1. CH5 operations and deployment.
2. ELF auth and hosted API.
3. Hosted frontend and provider-neutral agent-gateway boundary.
4. CLI receipts and MCP targeting.
5. PSD/image-editor/persistence.
6. Residual regressions proven against current upstream.

## Strategy

1. Freeze the current CH5 main and upstream `v0.14.0` identities.
2. Start merge state from CH5 main so shared history is not rewritten.
3. Replace the candidate tree with exact upstream using
   `upstream:replay-start`, then seed only config-declared additive CH5 paths.
4. Port surviving CH5 capabilities against upstream's current architecture.
5. Keep CH5 operations additive: `.ch5`, `.forgejo`, Hush, deployment scripts,
   and `docs/ch5`.
6. Delete CH5 implementations where upstream now provides the same feature.
7. Add or retain regression tests for every surviving CH5 contract.
8. Run the full configured verification, commit the merge, review the candidate,
   then push private main,
   then prove staging separately. Promote production only after operator review.

## Domain order

1. Package/workspace topology and lockfile.
2. Core scene graph, editor, renderer, Kiwi, and document I/O.
3. Vue SDK and app shell.
4. AI/ACP, hosted auth, and the provider-neutral agent-gateway boundary.
5. API, hosted storage, collaboration, and assets.
6. CLI, MCP, automation, and review tooling.
7. Tests, docs, desktop packaging, and deployment.

`docs/ch5/upstream-capabilities.md` is the decision inventory. Shared generated
files have a single owner.

## Retention rule

For each historical private patch:

1. Identify the user-visible or authority contract.
2. Run its focused regression against current upstream without the old patch.
3. If upstream passes, drop the patch.
4. If upstream partly passes, rebuild the narrow missing contract against
   upstream's current architecture.
5. If upstream has no equivalent, preserve it as an isolated CH5 capability.
6. Record every surviving upstream-file edit in the drift ledger.

Patch equivalence from `git cherry` is useful evidence, not semantic proof.

## Conflict-avoidance architecture

Deep integration does not require deep edits throughout upstream.

- Keep ELF identity and session policy in hosted app-shell and API adapters.
- Keep documents, assets, rooms, and persistence behind CH5-owned service
  interfaces.
- Keep hosted agent chat behind one typed app transport and one API adapter.
  OpenPencil must not provision runtimes or model provider, billing, worker,
  container, image, or registry concepts.
- Keep deployment, Hush, Forgejo, and promotion additive.
- Isolate image-editor/PSD/persistence in CH5-owned packages or narrow core
  extension points. Upstream-file edits require a drift-ledger row and focused
  test.
- Prefer upstream public exports and composition. Avoid copying upstream modules
  into CH5 namespaces.
- If a capability needs repeated edits across upstream internals, first add one
  stable extension seam, then carry the capability behind it.
- Target zero conflicts for weekly sync. Any conflict stops automatic landing.

## Acceptance

- Merge commit has CH5 main and exact upstream tip as parents.
- Drift ledger names every surviving upstream-file edit.
- No duplicate CH5/upstream implementation remains.
- `bun run upstream:inspect -- --json` no longer returns `program`.
- Full configured verification passes from a clean Grove Tree.
- Private main push and staging effect are proven; production remains explicit.
