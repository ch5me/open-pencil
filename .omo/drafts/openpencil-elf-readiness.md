# Draft: OpenPencil ELF Readiness

## Requirements (confirmed)
- use ELF custom auth client for OpenPencil auth
- prepare OpenPencil for cloud storage in the future ELF file store
- prepare hosted collaboration architecture
- exclude billing from scope; billing will be handled by ELF cloud
- OpenPencil should be a sub-app/submap of the ELF platform
- produce the full readiness plan so implementation can start as soon as ELF platform is ready

## Technical Decisions
- planning target: readiness architecture, seams, rollout order, and verification strategy rather than immediate implementation

## Research Findings
- `AGENTS.md`: repo declares planned federation via `@ch5me/elf-auth-client`, Kilo custom auth, per-user agent container provisioning, and no local LLM gateway
- current upstream codebase appears local-first with no implemented auth or hosted storage layer
- only one local worktree exists for this repo; no auth/cloud-specific local branches are checked out

## Open Questions
- preferred test lane for readiness work: TDD, tests-after, or minimal tests where infra is not yet present
- whether readiness plan should include desktop deep-link auth callback work now or stage it behind web/API readiness

## Scope Boundaries
- INCLUDE: auth seams, session contract, cloud document model, hosted collaboration design, rollout sequencing, migration strategy, verification
- EXCLUDE: billing implementation, full ELF platform implementation, immediate code changes outside planning artifacts
