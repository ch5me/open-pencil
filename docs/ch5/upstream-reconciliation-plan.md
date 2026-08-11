# Upstream reconciliation plan

## Goal

Produce one merge commit that records `upstream/master` as integrated while
preserving only deliberate CH5 behavior. Afterward, weekly sync should classify
as `routine` or `review`.

## Why this is a program

The August 11, 2026 inspection found 499 upstream-only commits, 715 fork-only
commits, 1,883 upstream-changed files, and 953 predicted conflicts. Resolving
that with line-by-line conflict choices would preserve accidental duplication
and make future merges worse.

## Strategy

1. Freeze the current CH5 main and upstream `v0.14.0` identities.
2. Start a merge from CH5 main so shared history is not rewritten.
3. Build the resolved tree from upstream's current architecture, then port
   surviving CH5 intent by domain.
4. Keep CH5 operations additive: `.ch5`, `.forgejo`, Hush, deployment scripts,
   and `docs/ch5`.
5. Delete CH5 implementations where upstream now provides the same feature.
6. Add or retain regression tests for every surviving CH5 contract.
7. Run the full configured verification, commit the merge, push private main,
   then prove staging separately. Promote production only after operator review.

## Domain order

1. Package/workspace topology and lockfile.
2. Core scene graph, editor, renderer, Kiwi, and document I/O.
3. Vue SDK and app shell.
4. AI/ACP, hosted auth, runtime provisioning, and billing boundaries.
5. API, hosted storage, collaboration, and assets.
6. CLI, MCP, automation, and review tooling.
7. Tests, docs, desktop packaging, and deployment.

Each domain gets one owner and one independent reviewer. Shared generated files
have a single owner.

## Acceptance

- Merge commit has CH5 main and exact upstream tip as parents.
- Drift ledger names every surviving upstream-file edit.
- No duplicate CH5/upstream implementation remains.
- `bun run upstream:inspect -- --json` no longer returns `program`.
- Full configured verification passes from a clean Grove Tree.
- Private main push and staging effect are proven; production remains explicit.
