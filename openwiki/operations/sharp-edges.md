---
type: operations-sharp-edges
title: Sharp Edges and Editing Invariants
description: 'These are the repository behaviors most likely to cause silent data loss, stale state, security exposure, or misleading validation when changing OpenPencil.'
tags: [operations, invariants, risks]
---

# Sharp Edges and Editing Invariants

- Always resolve the active editor store through tabs/active-store; automation and UI must not retain stale tab instances.
- Hosted flags are dependent and cached. Enabling a flag alone does not wire hosted document I/O; missing hosted clients intentionally fail.
- A document writer can no-op when no Tauri path or browser file handle exists. Use explicit download/export and backend capability checks; do not equate a returned promise with persisted bytes.
- Reload replaces the graph and clears undo history while restoring page/selection state. Collaboration must suppress graph/Yjs feedback loops and destroy persistence, awareness, and listeners on replacement/unmount.
- `@open-pencil/fig` is container-only; semantic SceneGraph `.fig` ownership remains in core. Preserve imported schema/source metadata and scan IDs before generating new GUIDs.
- CanvasKit is runtime-loaded in one loader; pass instances through renderer boundaries so CLI/headless tests remain viable.
- CLI output uses agentfmt and `--json`; do not hand-roll output. CLI file mode and live-app RPC mode have different supported export operations.
- MCP `eval` is opt-in, file operations are root-scoped, and broadening `HOST` or disabling auth changes exposure. Stdio requires an existing WebSocket app bridge.
- Do not use development auth stubs in staging/production. Named Wrangler environments must repeat their own bindings.
- Production deployment and rollback depend on manifests/history; inspect current scripts before assuming artifact promotion semantics.

Formatting and lint configuration are repository contracts: use `.oxfmtrc.json` and `oxlint.json` as the source of truth, not editor defaults. The pinned Oxlint config extends the shared `@ch5me/oxlint-config/react.json` preset; a formatter-only diff across many files is not evidence of a runtime behavior change. `bun run format:check` invokes Oxfmt with `--write` before checking the worktree, so review the resulting changes rather than treating it as read-only; also review `bun run lint:fix`/`bun run fix` output before committing.

Focused checks: `bun run format:check`, `bun run test:unit`, `bun run test`, `bun run check`, `bun run proof:all`, and the targeted tests linked from each architecture page.
