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

## Seed gate CLOSED 2026-09-11 (owner `thr_wjjkj9uq2c`)

`replay.additivePaths` expanded from 22 to 33 entries. Added, all verified
CH5-only (0 files upstream) and all slash-free so the helper's
`git cat-file -e <privateHead>:<path>` check resolves:

```
.ch5rc  .cloud-work/config.json  CLAUDE.md
scripts/export-fixture-visuals.ts  scripts/visual-bisect.ts  scripts/visual-compare.ts
tools/agent-gateway  tools/deployment  tools/hosted  tools/hosted-proof  tools/local-bootstrap
```

`.ch5` does not cover `.ch5rc`: `pathMatches` requires an exact match or a
`path + "/"` prefix, so the rc file needs its own entry.

### Acceptance proof

| Gate | Result |
| --- | --- |
| Unseeded CH5-only files outside upstream-owned trees | **0** |
| `artifacts/**` | excluded by design (1 receipt), regenerate — never seed |
| Seeded shims resolving to seeded implementations | **6 / 6** (was 1 / 6) |
| `bun test tests/engine/upstream-sync/` | 3 pass / 0 fail |
| `inspect` classification | `program`, `canAutomate: false` (unchanged) |
| `inspect` criticalFiles | 107 (unchanged by the seed edit) |
| `format:verify` | green, 2028 files |

Files under `packages/`, `src/`, `tests/`, `desktop/` remain deliberately
unseeded; the skill forbids seeding edits to upstream-owned source, and those
port one capability at a time.

### Landing dependency before replay

A dedicated Grove Tree binds from `origin/main`. This seed repair is committed on
the owner branch but **not pushed**, so a Grove bound today would still carry the
old 22-entry seed list and delete `tools/agent-gateway` et al. The expanded seed
list must reach `origin/main` before `replay-start` runs in a Grove. Landing it is
a gated decision, not taken by this owner.
