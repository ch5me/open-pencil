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

## Conflict flow

1. Run `bun run upstream:merge -- --allow-program` only inside the approved
   reconciliation lane.
2. Read each ledger row relevant to conflicted files.
3. Re-apply intent against the upstream shape; delete duplicated CH5 code.
4. Add focused regression tests for changed contracts.
5. Run `bun run upstream:finish -- --push`.

## Proof

Keep the JSON inspection report. Report upstream SHA, fork point, conflict count,
tests, pushed commit, staging run, and any production promotion separately.
