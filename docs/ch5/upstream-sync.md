# Upstream sync

OpenPencil is a private CH5 fork of `open-pencil/open-pencil`. The `upstream`
remote is fetch-only; its push URL is deliberately invalid.

## Commands

```sh
bun run upstream:inspect
bun run upstream:merge
bun run upstream:replay-plan
bun run upstream:replay-start -- --allow-program --confirm-upstream-first
bun run upstream:verify
bun run upstream:finish
bun run upstream:sync
```

- `inspect` fetches `origin/main` and `upstream/master`, predicts conflicts with
  `git merge-tree`, classifies drift, and changes no tracked files.
- `merge` starts a no-commit merge only when drift is within the configured
  automation envelope. `--allow-program` is an explicit one-time override.
- `verify` runs the exact gate list in `.ch5/upstream-sync.json`.
- `finish` requires a resolved merge, runs the gates, records the upstream SHA,
  and commits. Add `--push` to push `HEAD:main` and prove remote ancestry.
- `sync` composes `merge` and `finish`. Scheduled operation should use
  `bun run upstream:sync -- --push` from a clean Grove Tree.

Conflicts are preserved, never guessed away. Resolve intent using
`docs/ch5/upstream-drift.md`, add focused regression coverage for changed
contracts, then run `finish --push`.

## Runbook A: routine merge

Use only when `inspect` reports `routine` or `review`.

1. Bind a clean disposable Grove Tree from current `origin/main`.
2. Run `upstream:inspect -- --json --report <artifact>`.
3. For `review`, inspect every changed critical path before mutation.
4. Run `upstream:sync -- --push`.
5. Prove the pushed merge commit contains exact upstream as parent two.
6. Prove private CI and staging separately. Production remains explicit.

The scheduled weekly job may execute this runbook. It may not pass
`--allow-program`.

## Runbook B: upstream-first replay

Use when `inspect` reports `program`, historical intent is unclear, or resolving
individual conflicts would preserve obsolete architecture.

1. Freeze exact private-main and upstream SHAs.
2. Update `docs/ch5/upstream-capabilities.md` and the drift ledger.
3. Run `upstream:replay-plan -- --json --report <artifact>`.
4. In a dedicated Grove Tree, run:

   ```sh
   bun run upstream:replay-start -- \
     --allow-program \
     --confirm-upstream-first
   ```

   This creates merge state with private main as parent one, exact upstream as
   parent two, replaces the candidate tree with upstream, then restores only
   config-declared additive CH5 seed paths. It does not replay edits to
   upstream-owned source.
5. Port capabilities from `upstream-capabilities.md` in order. Each port brings
   its focused regression tests. Delete patches upstream now satisfies.
6. Add one drift-ledger row for every surviving edit to an upstream-owned file.
7. Run configured verification. Use `upstream:finish` without `--push`.
8. Compare the candidate with both upstream and current private main. Stop for
   operator review before push, staging, or production.

Abort a replay with `git merge --abort` only before durable candidate edits are
made. Once work is worth keeping, commit or salvage it; never reset it away.

## Classification

- `up-to-date`: nothing to integrate.
- `routine`: conflict-free and below drift thresholds.
- `review`: conflict-free, below thresholds, but touches critical paths.
- `program`: conflict count or drift size exceeds thresholds. Automation stops
  before mutating the tree and emits a report for a dedicated reconciliation.

Do not schedule automatic landing until `inspect` no longer reports `program`.
Register the eventual weekly job through `ch5-sched`; its workdir must be the
canonical checkout, while the job itself binds a disposable Grove Tree.

## Current baseline

Measured August 11, 2026:

- Fork point: `ec31ea11865fa239b03aa739e8d37f903a252a10`
- Upstream tip: `9ceb7a7bea2ff63d18dacf28a9747b83100113e7`
- Pending upstream commits: 499
- Fork-only commits: 715
- Predicted conflicts: 953

This is a one-time upstream-first replay program, not a safe weekly merge. The
scripts correctly refuse routine automatic integration until that baseline is
repaired.

## Current verification status

Measured August 11, 2026:

- Upstream workflow unit tests: 2 passed.
- Repo-local app and docs routes: serving HTTP 200.
- Browser smoke: OpenPencil editor shell rendered and exposed its canvas,
  menus, pages, toolbar, design panel, and share control.
- `bun run check`: red on the existing repository lint/type baseline.
- `bun run test`: red before completion, including the existing missing
  automation WebSocket at `127.0.0.1:7601` and a File-menu expectation.

Weekly automatic landing stays disabled until the upstream reconciliation and
the repo gate baseline are green.
