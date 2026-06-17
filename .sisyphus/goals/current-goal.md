# Current Goal

## Goal As Stated

Migrate `/Users/hassoncs/src/ch5/open-pencil` off GitHub surfaces for CH5 HQ.

## Interpreted Goal

Make Forgejo (`git.ch5.me`) the primary git and CI surface, make Verdaccio (`npm.ch5.me`) the package publish/install surface for CH5/OpenPencil packages, keep GitHub only as downstream mirror or explicit external distribution exception, then prove and land the migration on the primary branch.

## Success Criteria

- `hq` remote exists and points at `https://git.ch5.me/ch5/open-pencil.git`.
- GitHub `origin` remains only as mirror if still configured.
- CH5-owned workflows live under `.forgejo/workflows`, not `.github/workflows`.
- GitHub Packages registry refs are absent; package publish config targets `https://npm.ch5.me/`.
- CH5-owned GHCR refs are absent or replaced with `oci.ch5.me`.
- Closest local install/build/test proof has run.
- Migration commit is on the primary branch and pushed to HQ, with GitHub mirror push attempted if configured.
- Forgejo/Dasio run status checked when the workflow exists.

## Constraints

- Work only in `/Users/hassoncs/src/ch5/open-pencil`.
- Do not edit `/Users/hassoncs/src/ch5/ch5-company/docs/company/hq-migration-status.md`.
- Preserve unrelated work; do not revert other agents' edits.
- Keep upstream third-party GitHub references when they are not CH5-owned surfaces.

## Non-Goals

- No ch5-company audit-doc updates.
- No broad product/docs rewrite outside HQ migration references.
- No secret printing or credential migration unless required to complete the HQ push.

## Current State

Migration files prepared. Local install, package build, and Vite build pass.
Full build/check is blocked by existing lint rule failures. Unit suite reached two
existing fig roundtrip size assertion failures, then entered the heavy fixture lane.
HQ repo still needs Forgejo creation/push verification.

## Plan

1. Inspect remotes, branch, dirty work, registry/CI/container refs.
2. Move CH5-owned CI to Forgejo and retarget package/git/release refs.
3. Commit migration slice on primary branch.
4. Create/verify Forgejo repo, push HQ plus origin mirror if configured, verify Forgejo/Dasio run.

## Next Update Triggers

- HQ remote creation/push succeeds or blocks.
- Local proof fails for migration-caused reason.
- Forgejo/Dasio run starts, passes, fails, or cannot be found.
