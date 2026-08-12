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
| Runtime provisioning and billing        | Route agent work through Firefly-owned runtime authority                                              | Upstream adopts the same authority split                                            | Preserve typed failure and exact runtime identity receipts                                                                                        |
| CH5 product extensions                  | OpenPencil is Firefly/ELF's design surface, including image editing and PSD workflows                 | Upstream equivalents land or maintained upstream-file delta exceeds one page        | Delete duplicate code first; keep required capabilities behind CH5-owned packages and narrow extension seams                                      |

## Reconciliation done bar

- Every surviving upstream-file edit has a ledger row.
- Duplicate CH5/upstream features are collapsed to one implementation.
- `bun run upstream:inspect` reports `routine` or `review`, not `program`.
- Full configured verification passes before the merge commit lands.
