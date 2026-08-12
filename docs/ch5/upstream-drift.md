# Upstream drift ledger

This ledger records CH5 intent that edits or replaces upstream-owned behavior.
Resolve future conflicts by preserving the intent, not by blindly choosing
either side's diff.

## Current status

`PROGRAM`: the historical ledger is incomplete. The fork has 725 fork-only
commits after the May 26, 2026 fork point: 413 substantive, 191 agent
checkpoints, 90 merges, and 31 generated, fixture, or hygiene commits. Treat the
repository as a hard fork until the one-time reconciliation reconstructs this
ledger and restores a small maintained delta.
`docs/ch5/upstream-capabilities.md` is the replay inventory.

## Known CH5 intent

| Area                                    | Why CH5 carries it                                                                                    | Invalidation signal                                                                 | Re-application rule                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ELF hosted auth                         | Protect `design.elf.dance` with ELF RS256/JWKS auth                                                   | Upstream introduces a compatible hosted auth boundary                               | Keep auth at additive API/router seams; avoid editor-core changes                                                                                 |
| Hosted API and storage                  | Persist hosted documents, assets, rooms, and user state                                               | Upstream ships an equivalent backend contract                                       | Prefer adapters around upstream document/session APIs                                                                                             |
| Storage provider registry and selection | Reuse upstream local-first workspace while selecting ELF storage automatically in hosted-docs mode    | Upstream adds a credential-free runtime provider or first-class hosted adapter seam | Keep `hosted-elf` registration and hosted-mode selection narrow; preserve S3 selection in local mode; run hosted adapter and registry regressions |
| Hosted document route bootstrap         | Deep links at `/hosted/:documentId` must open the matching ELF document through upstream tabs/storage | Upstream router can bind a storage document directly                                | Keep route bootstrap at app-shell/tab seams; do not fork document IO; run hosted route regression                                                 |
| Hosted title persistence                | Upstream storage sync sends current document names, so ELF snapshots must update hosted metadata      | Upstream hosted backend accepts metadata on snapshot writes                         | Keep optional title on snapshot PUT and its CRUD regression                                                                                       |
| CH5 deployment                          | Stage and promote through Forgejo, Hush, and Cloudflare                                               | Upstream deployment becomes compatible with CH5 authority                           | Keep `.forgejo`, `.ch5`, `scripts`, and `docs/ch5` additive                                                                                       |
| Provider-neutral hosted agent gateway   | Route hosted chat through an authenticated service without exposing its infrastructure                | Upstream adds an equivalent remote agent transport seam                             | Keep one app transport and one API adapter; preserve typed errors, opaque trace IDs, cancellation, and no hosted-to-local fallback                |
| Hosted chat transport selection         | Hosted OpenPencil must use its configured agent gateway rather than upstream BYOK or local ACP        | Upstream supports an equivalent authority-selected remote transport                 | Select the gateway before provider/ACP choice; never fallback; reject model, provider, billing, worker, container, image, or registry coupling    |
| Targeted lint execution                 | CH5 review receipts must prove the exact requested rule/node mappings rather than whole-document lint | Upstream linter gains equivalent targeted execution                                 | Keep `lintChecks` as the one core seam; reject missing nodes/rules; run focused lint regressions                                                  |
| CLI bootstrap provenance                | Review receipts bind the exact CLI and production dependency bytes used during execution              | Upstream CLI exposes equivalent provenance hooks                                    | Capture before command imports, verify after lint, keep normal CLI output unchanged, and run provenance regressions                               |
| Image-extension package seams           | Firefly/ELF needs PSD, raster composition, image resilience, and atomic image persistence APIs        | Upstream exposes equivalent public extension APIs                                   | Keep implementation additive; expose only explicit core subpaths; never restore parallel tabs, document storage, history, or renderer authorities |

## Reconciliation done bar

- Every surviving upstream-file edit has a ledger row.
- Duplicate CH5/upstream features are collapsed to one implementation.
- `bun run upstream:inspect` reports `routine` or `review`, not `program`.
- Full configured verification passes before the merge commit lands.
