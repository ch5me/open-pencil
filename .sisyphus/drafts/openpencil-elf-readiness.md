# Draft: OpenPencil ELF Readiness

## Requirements (confirmed)
- use ELF custom auth client for OpenPencil auth
- prepare OpenPencil for cloud storage in the future ELF file store
- prepare hosted collaboration architecture
- exclude billing from scope; billing will be handled by ELF cloud
- OpenPencil should be a sub-app/submap of the ELF platform
- produce the full readiness plan so implementation can start as soon as ELF platform is ready
- confirm whether the ELF auth package is actually aligned with Firefly Cloud reality
- if not aligned, include the alignment/implementation work needed before OpenPencil should depend on it
- rename any public-facing auth/token/key/package terminology so it uses `ELF`, not `Kilo`

## Technical Decisions
- planning target: readiness architecture, seams, rollout order, and verification strategy rather than immediate implementation
- tests-after is the execution posture
- desktop auth handoff/deep-link implementation is deferred until web/API hosted flows are proven
- hosted collaboration will be staged behind auth + hosted document identity stabilization
- OpenPencil must not treat the auth package as canonical until package contract and Firefly consumers are unified
- public-facing naming policy: `ELF` is the external/product auth namespace; `Firefly` remains the internal codename; `Kilo` must not remain in public token/key/package naming

## Research Findings
- `AGENTS.md`: repo declares planned federation via `@ch5me/elf-auth-client`, Kilo custom auth, per-user agent container provisioning, and no local LLM gateway
- current upstream codebase appears local-first with no implemented auth or hosted storage layer
- only one local worktree exists for this repo; no auth/cloud-specific local branches are checked out
- `.ch5/services.yaml` already declares intended hosted runtime pieces: Worker API, D1, R2 documents/assets, Durable Object `DocumentRoomDO`
- collaboration today is P2P Trystero + Yjs + IndexedDB, wired through `src/app/collab/*`
- document persistence today is local-only via Tauri fs / File System Access API / Safari download fallback, wired through `src/app/document/io/*`
- CI/deploy stack already exists for local-first app quality and Cloudflare Pages preview/prod deploys
- external research supports cookie-first web auth, Worker session resolution, Durable Objects + Yjs, and R2 snapshots/assets for hosted mode
- Firefly Cloud auth reality is mixed: `apps/web` still uses NextAuth v4, while `apps/firefly-api` and `apps/firefly` use Better Auth-based session flows
- the ELF auth package exists and has real RS256/JWKS verifier code, but there are two divergent variants: scoped `@ch5me/elf-auth-client` in `ch5-packages` and unscoped `elf-auth-client` in `firefly-cloud`
- the two package variants disagree on payload field naming (`kiloUserId` vs `fireflyUserId`), so OpenPencil must not integrate until package source-of-truth is unified
- current browser/react helpers in the auth package are localStorage-token oriented and do not match Firefly Cloud's actual cookie-first hosted web flow

## Open Questions
- canonical hosted document identity model needs to be fixed during implementation: room=document vs derived room ID
- hosted MVP ordering must stay narrow: single-user hosted docs before broad sharing/product surface

## Scope Boundaries
- INCLUDE: auth seams, session contract, cloud document model, hosted collaboration design, rollout sequencing, migration strategy, verification
- INCLUDE: auth package validation, source-of-truth selection, and package/consumer alignment prerequisites
- INCLUDE: naming alignment for public-facing tokens, keys, endpoints, docs, and package contracts
- EXCLUDE: billing implementation, full ELF platform implementation, immediate code changes outside planning artifacts
