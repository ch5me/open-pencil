# Linked Images Hot-Reload — Learnings

## Task 1 — Product Contract (2026-05-03)

### What was found

- `ImageFillPicker.vue` currently only supports manual file upload via `useFileDialog`. No URL input, no link state, no refresh affordance. The "Link image" button is entirely new UI.
- `scene-graph.md` documents `imageHash` as the fill's image reference and `graph.images` as `Map<string, Uint8Array>`. The renderer contract is hash → bytes, with no concept of source origin.
- The `LinkedImageRegistry` at `packages/core/src/linked-images/registry.ts` already exists with stable synthetic keys (`linked-img-${nodeId}-${fillIndex}`), status tracking, and a side-table design that leaves `Fill` unchanged.
- The `decisions.md` notepad already captured the key architectural decisions from a prior session. The product contract formalizes those decisions into a user-facing document.

### Key decisions locked in the contract

1. **Mental model:** "linked source resolves to bytes; saved .fig is a snapshot." The source is annotation; the snapshot is the product.
2. **Three source classes:** local file (desktop only), local web URL, hosted URL. No authenticated sources in v1.
3. **Stable synthetic keys:** `fill.imageHash` = `linked-img-${nodeId}-${fillIndex}`. Refresh replaces bytes under the same key; the fill never changes.
4. **Refresh is user-initiated only.** No background polling, no file-watch auto-refresh in v1.
5. **Two broken states:** no snapshot (red, placeholder rendered) vs. stale snapshot (yellow, last bytes still rendered). Failed refresh is non-destructive.
6. **Save/export:** snapshot bytes embedded in `.fig` blob section. Source annotation travels alongside but is not required to render.
7. **Fill interface unchanged.** Source metadata lives in the registry side-table, not in any new fill field.

### Sharp edges for implementers

- The renderer's `imageCache: Map<string, CKImage>` must be invalidated when bytes change under a stable key. The key doesn't change, so the cache won't auto-invalidate.
- CORS is a real constraint in the browser build. The desktop build bypasses it via Tauri's HTTP client. The contract documents this explicitly so UI copy can differ per build target.
- The `LinkedImageRegistry` is already implemented (Task 2 was done before Task 1 was formally written). The contract is consistent with the registry's design.

### Files produced

- `docs/linked-images-product-contract.md` — the v1 product contract
- `.sisyphus/evidence/open-pencil-linked-images/task-1-contract-coverage.txt` — coverage verification
- `.sisyphus/evidence/open-pencil-linked-images/task-1-scope-guardrails.txt` — scope guardrails verification

## Task 8 — Local Watch + Reload Orchestration (2026-05-03)

### What changed

- `src/stores/linked-images.ts` now owns path-scoped watch state so multiple linked fills pointing at the same local file share one watcher and refresh fan-out.
- Local `path` sources use Tauri fs watch first, then fall back to polling file `mtime` every 2s if native watch setup fails.
- Burst writes are coalesced with a 1000ms debounce before calling `refreshImage(imageKey)`, which keeps auto-reload responsive without storming immediate re-resolves.
- `url` sources remain manual-refresh only; auto-watch gating stays tied to `sourceType === "path"`.
- `src/stores/editor.ts` now starts linked-image watches when the editor store is created and stops them during dispose, reusing the same lifecycle shape as `.fig` file watching.

### Sharp edges

- `startWatchingLinkedImages()` now acts as an enable switch, not just a one-shot sync. `linkImage()` / `relinkImage()` only attach new path watchers while that flag is enabled.
- `stopWatchingLinkedImages()` must clear both native watchers and pending debounce timers; otherwise a late timeout can refresh after teardown.
- Shared path watchers mean removal/relink must detach by image key and only stop the underlying watcher when the last linked record for that source disappears.

## Task 8 — Local Watch + Reload Orchestration (2026-05-03)

### What was implemented

- `src/stores/linked-images.ts` now owns per-path watcher lifecycle for linked images, keyed by the local `source` path instead of by document path.
- Only `sourceType: "path"` records auto-watch. `url` and `figma-remote` stay manual-refresh only via the existing `refreshImage(imageKey)` path.
- Watch events coalesce per source path with a `WATCH_DEBOUNCE_MS = 1000` timer before calling `refreshImage(imageKey)`, so bursty writes collapse into one refresh wave.
- Tauri uses `@tauri-apps/plugin-fs` `watch()` with modify-event filtering first, then falls back to polling file stat timestamps every 2s if watcher setup fails.

### Sharp edges

- The linked-image store must tear down watchers when a record is removed or relinked away from a local path, otherwise stale paths will keep refreshing detached keys.
- `refreshImage()` is intentionally still the manual path; watch-driven reloads debounce outside the resolver because manual refresh should remain immediate for non-watchable sources.
- Repo-wide scripted `bun run check` / `bun run build` are currently blocked by pre-existing workspace issues (`oxlint` script environment and unresolved `@tauri-apps/plugin-http` in core resolver). Changed store files were kept LSP-clean locally.

## Task 9 — Linked image affordances in `ImageFillPicker` (2026-05-03)

### What changed

- `ImageFillPicker.vue` now has a small internal mode switch between the existing embedded upload flow and a new linked-image flow, instead of replacing the whole image-fill UI.
- Linked fills auto-open the `Link image` tab and hydrate the matching URL or path input from `getLinkedImageStatus(fill.imageHash)`.
- Broken linked sources must still write the stable linked key into `fill.imageHash`; otherwise the UI loses the source context and can no longer show recovery actions.
- Removing a linked source should preserve the current snapshot when bytes still exist. The simplest UI-side path is: read current bytes from `store.getImage(linkedKey)`, re-store them as an embedded image with `store.storeImage(...)`, then call `removeLinkedImage(linkedKey)`.

### Sharp edges

- Replacing a linked image through the old upload button should clear the linked registry entry first, or path/url watchers can outlive the fill and keep stale records around.
- The inline `Link` buttons are safest as new-link actions only. Once a record exists, `Relink` should handle source changes so watcher cleanup continues to flow through the dedicated relink/remove code paths.
- `ImageFillPicker` can infer `nodeId` and `fillIndex` from `store.selectedNode.value` plus the exact fill object reference passed through `FillPickerRoot`; that is enough to call `linkImage(...)` without redesigning parent components.

## Task 9 — Image fill link affordances (2026-05-03)

### What changed

- `ImageFillPicker.vue` now splits image entry into two local tabs: Upload keeps the existing embedded-image chooser, and Link image adds source-driven controls.
- Linked-image status in the UI cannot rely on the registry record alone because the registry map is not Vue-reactive. The component needs a local snapshot (`linkedImageRecord`) that is refreshed after link / relink / refresh actions and when `fill.imageHash` changes.
- Failed first-time links should still update the fill to the stable linked image key returned by `linkImage()`. Otherwise the user loses the broken-source panel and can't see the error or retry in place.

### Sharp edges

- Replacing a linked image through the existing upload flow should remove the registry entry first, or stale linked-image records remain behind after switching back to an embedded image.
- `linkImage()` needs nodeId + fillIndex, so the UI currently depends on resolving the active selected node and matching the exact fill object in its `fills` array.
- Repo-wide build verification is still blocked by pre-existing linked-images workspace issues outside this component (`@tauri-apps/plugin-http` resolution in core, plus lint-script environment drift).

## Task 10 — Save/export/collab compatibility (2026-05-03)

### What changed

- Linked-image snapshot bytes were already written into `graph.images` by the resolver under stable `linked-img-${nodeId}-${fillIndex}` keys, and .fig export already includes every `graph.images` entry as `images/${hash}`.
- The round-trip gap was the node fill key: Kiwi paint hashes are byte-oriented, so non-hex stable keys needed OpenPencil metadata to restore the exact `fill.imageHash` after import. Export now writes a `linkedImageKeys` plugin-data map keyed by fill index; import uses it to restore the linked key without storing source URLs.
- Collab had a stale-byte gap for refreshes because `syncNodeToYjs()` and `syncAllNodesToYjs()` only set yimages when the key was missing. They now update yimages when bytes differ.
- Successful linked-image resolve emits a targeted node update when the fill already references the linked key, so byte refreshes trigger the existing collab sync path even though the fill itself stays stable.

### Persistence boundary

- Persisted/synced: snapshot bytes in `graph.images` / `yimages`, plus the stable fill image key needed to find those bytes.
- Dev/runtime-only: registry source URL/path/figma-remote metadata, status, contentHash, last error, local file watchers, debounce timers.
- v1 peers still do not need to understand source URLs, and no URL fields were added to Kiwi serialization.

## Task 11 — Proof board + scripted refresh (2026-05-03)

### What changed

- Added `scripts/proof-linked-images.ts` plus a root `bun run proof:linked-images` script to build a repeatable proof board, render it, swap one linked source, and render again.
- The proof uses three stable linked keys (`linked-img-${nodeId}-0`) registered through `LinkedImageRegistry`, then resolves bytes into `graph.images` under those same keys.
- Headless Bun proofing cannot use `sourceType: "path"` through the core resolver because local-path reads are Tauri-only today, so the script stands up a tiny local HTTP image server and links the board to `http://127.0.0.1:*` fixture URLs instead.
- For visible refresh proof, the script overwrites the red source file with `gradient-8x8.png` before re-resolving the same stable key; this guarantees the exported board PNG changes.

### Sharp edges

- `renderer.invalidateImage(linkedKey)` alone was not enough for repeatable exported proof because the renderer can still reuse node-level cached pictures. The script also re-emits the node fills with `graph.updateNode(node.id, { fills: [...node.fills] })`, matching the runtime store's snapshot-changed behavior.
- `red-square-updated.png` is byte-distinct from `red-square.png` but was not a reliable visible-proof fixture in the exported board; use a visibly different fixture when the proof needs changed pixels, not just changed bytes.

## Task 11 — Scripted linked-image proof board (2026-05-03)

### What changed

- Added `scripts/proof-linked-images.ts`, plus `package.json` script alias `bun run proof:linked-images`, to generate a repeatable three-image linked proof board and a second refreshed capture.
- The proof flow uses the real registry + resolver path (`LinkedImageRegistry`, `resolveSourceImmediate`, and stable `makeLinkedImageKey(nodeId, 0)` fills), writes `.fig` + `.png` outputs, and emits the required evidence text files under `.sisyphus/evidence/open-pencil-linked-images/`.
- Headless Bun proof cannot use `sourceType: "path"` because local path resolution in `resolver.ts` is Tauri-only. The script works around that by serving fixture PNGs from a tiny local HTTP server, then swapping the served bytes from `red-square.png` to `red-square-updated.png` before re-resolving the same linked key.

### Sharp edges

- For refresh proof, the source URL must stay constant while the served bytes change. That is what proves the renderer-facing key stayed stable and only `graph.images.get(linkedKey)` changed.
- The proof board verification helper only checks keys present in `graph.images`; keeping the board image-only avoids accidental extra image blobs that would make the count exceed three.

## Task 12 — Broken/stale/loading linked-image treatment (2026-05-03)

### What changed

- `packages/core/src/canvas/fills.ts` now treats missing or undecodable `linked-img-*` bytes as a first-class fallback instead of returning `false` and leaving the fill blank.
- The canvas fallback is renderer-safe: linked image fills now paint a tinted placeholder with a red X and `Source unavailable` label, so missing snapshots do not crash or disappear silently.
- `ImageFillPicker.vue` now distinguishes linked states more precisely:
  - loading = spinner treatment
  - broken with no snapshot = red placeholder + retry affordance
  - stale snapshot = existing preview stays visible while warning UI turns yellow
- Manual recovery stays on the existing store contract: the broken-state action still routes through `store.refreshImage(imageKey)`, but the button label now switches to `Retry` when the linked record is in error.

### Sharp edges

- The core renderer still only knows `imageHash -> bytes`, so stale-vs-broken differentiation on canvas must stay snapshot-driven: if bytes exist, render them; if they do not, show the fallback placeholder.
- `ImageFillPicker` cannot rely on `fill.imageHash` changes alone after refresh because linked refresh keeps the stable synthetic key. The UI must explicitly resync preview bytes and linked-record status after refresh/relink actions.

## Task 13 — Docs for linked screenshot-board workflow (2026-05-03)

### What changed

- Added `docs/linked-images-workflow.md` as the operator-facing guide for using linked images on dev screenshot boards.
- The doc makes the v1 persistence boundary explicit: source URL/path is for dev refreshes, while saved `.fig` files and exports use embedded snapshot bytes.
- The recommended default workflow is local-server URLs, because it works for repeatable proofing and aligns with the scripted `bun run proof:linked-images` flow.
- The doc separately calls out desktop-only local-file linking, browser CORS constraints, and the lack of authenticated-source support so operators do not over-assume live-link behavior.

### Sharp edges

- For human readers, the easiest place to get confused is save semantics. The doc should keep repeating that `.fig` is a snapshot, not a live source dependency.
- The proof script is a URL-based proof even though local files are supported in the desktop app; that distinction matters because headless Bun proofing cannot use the Tauri-only file resolver path.
- Relink wording was corrected to match the v1 contract: v1 does not support in-place source editing, so relink means remove + re-link, not a separate "change URL" action.
- Markdown heading hierarchy was cleaned up: limitation sub-sections now use `###` under the `##` "Limitations you must account for" parent, eliminating an earlier duplicate `##` pattern.
- Evidence files verified: `task-13-doc-coverage.txt` confirms all 14 coverage areas present; `task-13-proof-doc.txt` confirms proof workflow completeness.
- Evidence: `.sisyphus/evidence/open-pencil-linked-images/task-13-doc-coverage.txt` and `task-13-proof-doc.txt`.
