# Files

- [Runtime Configuration and Environment Topology](configuration.md) - Local, preview, staging, and production differ through hosted feature flags, API origins, Cloudflare bindings, browser/PWA/Tauri startup, and generated runtime contracts. Secret values are intentionally omitted.
- [Quality, CI, Build, and Release Workflow](quality-and-release.md) - The repository uses Bun workspaces, Oxlint/tsgo/Vue checks, Bun engine tests, Playwright E2E, Forgejo CI, tag-gated Tauri/package releases, and staged Cloudflare Pages promotion.
- [Sharp Edges and Editing Invariants](sharp-edges.md) - These are the repository behaviors most likely to cause silent data loss, stale state, security exposure, or misleading validation when changing OpenPencil.
