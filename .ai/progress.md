2026-05-03 — Task 10 linked image save/export/collab compatibility

- Hardened .fig round-trip for linked images by preserving stable `linked-img-*` fill keys via OpenPencil plugin metadata while keeping source URLs out of Kiwi serialization.
- Verified/exported snapshot bytes remain embedded from `graph.images` as `images/${linkedKey}`.
- Hardened collab yimages sync to update existing linked image keys when refreshed bytes differ and to emit a node update after successful linked-image refresh.
- Added fig round-trip regression coverage and evidence files under `.sisyphus/evidence/open-pencil-linked-images/`.
- Verification: `bun test ./tests/engine/fig-roundtrip.test.ts` passed (51 pass, 8 skip, 0 fail).

2026-05-03 — Task 11 linked image proof board

- Added `scripts/proof-linked-images.ts` and `bun run proof:linked-images` to generate a three-image linked proof board, export initial/final PNGs, and save a `.fig` board artifact.
- Scripted refresh keeps the same stable linked key while swapping the red source file to `gradient-8x8.png`, then re-resolves and re-renders without reopening the document.
- Wrote proof artifacts to `.sisyphus/evidence/open-pencil-linked-images/task-11-proof-board.txt` and `task-11-proof-refresh.txt`.
- Verification: `bun run proof:linked-images` passed. Changed-file LSP diagnostics are clean. Full repo `bun run check` is currently blocked by pre-existing workspace issues in `packages/core/src/linked-images/resolver.ts`, `packages/core/src/editor/create.ts`, and existing max-lines warnings unrelated to this task.
