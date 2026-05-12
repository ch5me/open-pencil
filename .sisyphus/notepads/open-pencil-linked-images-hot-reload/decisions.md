# Linked Images — Decisions Log

## Wave 1, Task 1 — Product Contract (2026-05-03)

**Contract written:** `packages/docs/reference/linked-images.md`

### Key decisions locked

- Mental model: "linked source resolves to bytes; saved .fig is a snapshot."
- Source metadata lives in a dev-side resolution layer, NOT in `Fill` interface.
- Three supported source classes: local file (desktop only), local web URL, hosted URL.
- No authenticated sources in v1.
- No auto-refresh in v1 — all refresh is user-initiated.
- Broken-source UX: two states (no snapshot = red placeholder; stale snapshot = yellow warning, still renders last bytes).
- Refresh is non-destructive: failed refresh preserves existing snapshot.
- Save/export: snapshot bytes embedded in .fig blob section; source annotation travels alongside but is not required to render.
- SVG source type deferred to future work (requires rasterization strategy).
- `Fill` interface unchanged — no new fields added to core fill render contract.
