# Upstream-first replay gate

Measured 2026-09-11 from local refs. No upstream fetch this pass.

| Ref | SHA |
|---|---|
| private HEAD at plan | see current `origin/main` after land |
| `upstream/master` (cached) | `9d4fe4e421ac2be301a3d76a0c7d7883350656a8` |
| merge-base | `51ab21571ad29cf86e4862e145dcf9e937860390` |

Classification remains `program` (412 upstream / 905+ fork / 156 conflicts).
Do not line-resolve. Do not `replay-start` until the seed gap is closed.

## Remaining gate (blocks `replay-start`)

`replay.additivePaths` seeds `tools/ch5` and the listed shims, but not
`tools/agent-gateway`, `tools/deployment`, `tools/hosted-proof`,
`tools/local-bootstrap`, `tools/hosted`, plus a few CH5 scripts and
`.ch5rc` / `.cloud-work/config.json` / `CLAUDE.md`. Exact list:
`docs/ch5/upstream-drift.md` § BLOCKER.

`replay-start` would restore shims and delete the modules they import.

## Allowed next command (owner Grove, after seed repair)

```sh
bun run upstream:replay-start -- --allow-program --confirm-upstream-first
bun run upstream:finish
```

Finish without `--push`. Merge parents must be private `main` then exact
`9d4fe4e421ac2be301a3d76a0c7d7883350656a8`.

Local-only plan JSON:
`~/.bb-nightly/thread-storage/thr_4yhhjds9rn/artifacts/upstream-replay-plan.json`
