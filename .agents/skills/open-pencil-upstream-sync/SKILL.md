---
name: open-pencil-upstream-sync
description: Maintain the OpenPencil private fork against open-pencil/open-pencil. Use for sync upstream, update our OpenPencil fork, inspect fork drift, resolve upstream conflicts, or prepare the weekly fork refresh. Uses the repo-owned deterministic sync script, drift ledger, full gates, direct-main push, and staging CI. Do NOT use for contributing upstream.
---

# OpenPencil upstream sync

## Critical

- Upstream is read-only. Never push, open a PR, file an issue, or send a patch.
- Work in a clean Grove Tree.
- Run `bun run upstream:inspect -- --json` first.
- `program` means stop automatic merge and create a dedicated reconciliation
  plan from the report. Never pass `--allow-program` without owning that plan.
- Resolve conflicts by preserving intent from `docs/ch5/upstream-drift.md`.
- A successful sync ends only after configured gates pass, the merge is
  committed, `HEAD:main` is pushed, and remote ancestry is proven.

## Routine flow

```sh
bun run upstream:inspect -- --json
bun run upstream:sync -- --push
```

The push triggers normal Forgejo CI and staging deployment. Production promotion
remains the repository's explicit promotion workflow.

## Upstream-first replay

Use for `program`, unclear historical intent, or hard-fork-scale drift.

1. Read `docs/ch5/upstream-capabilities.md` and the drift ledger.
2. Run `bun run upstream:replay-plan -- --json`.
3. In the dedicated candidate Tree, run
   `bun run upstream:replay-start -- --allow-program --confirm-upstream-first`.
4. Port one capability and its focused tests at a time. Delete code upstream
   now supplies.
5. Run `bun run upstream:finish` without push and stop for review.

## Proof

Keep JSON inspection/replay reports. Report upstream SHA, fork point, candidate
merge parents, tests, pushed commit, staging run, and production separately.
