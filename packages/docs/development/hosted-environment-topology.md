---
title: Hosted Environment Topology
description: Feature flags, environment matrix, and URL contract for OpenPencil's hosted rollout.
---

# Hosted Environment Topology <!-- oc:id=sec_aa -->

This page defines the feature flags, environment matrix, and URL contract for enabling hosted auth, hosted documents, and hosted collaboration independently across local, preview, staging, and production environments.

## Feature Flags <!-- oc:id=sec_ab -->

Three boolean gates control hosted capabilities independently:

| Flag | Env var | Default | Purpose |
|---|---|---|---|
| `hostedAuth` | `VITE_HOSTED_AUTH_ENABLED` | per-environment | ELF-hosted auth (cookie-first web session) |
| `hostedDocs` | `VITE_HOSTED_DOCS_ENABLED` | per-environment | Hosted document storage (D1 + R2 via Worker API) |
| `hostedCollab` | `VITE_HOSTED_COLLAB_ENABLED` | per-environment | Hosted real-time collaboration (Durable Object rooms) |

Each flag resolves from its env var override first; when the var is unset, the per-environment default from `config/hosted-topology.json` is used.

### Dependency Constraints <!-- oc:id=sec_ac -->

- `hostedDocs` requires `hostedAuth` to be enabled.
- `hostedCollab` requires both `hostedAuth` and `hostedDocs` to be enabled.
- Violations are caught by `validateHostedConfig()` in `@open-pencil/core/hosted`.

## Environment Matrix <!-- oc:id=sec_ad -->

| Environment | `hostedAuth` | `hostedDocs` | `hostedCollab` | API Origin | Auth Callback URL | App URL |
|---|---|---|---|---|---|---|
| `local` | off | off | off | (empty) | (empty) | `http://localhost:1420` |
| `preview` | on | off | off | `https://api.staging.pencil.ch5.me` | `https://pencil.ch5.me/api/auth/callback` | Pages-deployed URL |
| `staging` | on | on | off | `https://api.staging.pencil.ch5.me` | `https://staging.pencil.ch5.me/api/auth/callback` | `https://staging.pencil.ch5.me` |
| `production` | on | on | off | `https://api.pencil.ch5.me` | `https://pencil.ch5.me/api/auth/callback` | `https://pencil.ch5.me` |

### Design Rationale <!-- oc:id=sec_ae -->

- **Preview**: Auth enabled for session verification smoke tests; docs off to isolate auth from storage risk.
- **Staging**: Docs enabled for single-user storage validation before production promotion.
- **Production**: Mirrors staging defaults; flags can be toggled independently via env var overrides without rebuild.
- **Collaboration**: OFF in all environments until the Durable Object room transport lands (task 12).

## Operating Mode Derivation <!-- oc:id=sec_af -->

The flag combinations map to the four operating modes defined in [Hosted Operating Modes](./hosted-operating-modes.md):

| Flag combination | Operating mode |
|---|---|
| all off | `local-only` |
| auth only | `hosted-auth-local-docs` |
| auth + docs | `hosted-docs-single-user` |
| auth + docs + collab | `hosted-collab` |

The app exposes `getOperatingMode()` from `src/app/hosted/flags.ts` which derives this at runtime.

## Runtime Environment Variable Contract <!-- oc:id=sec_ag -->

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `OPENPENCIL_HOSTED_ENV` | `local \| preview \| staging \| production` | No | `local` | Declares the runtime environment |
| `VITE_HOSTED_AUTH_ENABLED` | `true \| false` | No | per-environment default | Override for hosted auth flag |
| `VITE_HOSTED_DOCS_ENABLED` | `true \| false` | No | per-environment default | Override for hosted docs flag |
| `VITE_HOSTED_COLLAB_ENABLED` | `true \| false` | No | per-environment default | Override for hosted collab flag |
| `VITE_API_ORIGIN` | URL string | No | per-environment default | Override for the Worker API base URL |
| `VITE_AUTH_CALLBACK_URL` | URL string | No | per-environment default | Override for the ELF auth callback URL |
| `VITE_APP_URL` | URL string | No | per-environment default | Override for the public app URL |

### No Implicit Environment Guessing <!-- oc:id=sec_ah -->

The environment is determined solely by `OPENPENCIL_HOSTED_ENV`. There are no hostname checks, no `window.location` sniffing, and no `import.meta.env.MODE` fallbacks. When `OPENPENCIL_HOSTED_ENV` is unset, the runtime resolves to `local` with all hosted features off.

## API <!-- oc:id=sec_ai -->

### `@open-pencil/core/hosted` (types + validation) <!-- oc:id=sec_aj -->

```ts
import type { HostedFeatureFlags, HostedEnvironmentConfig, OperatingMode } from '@open-pencil/core/hosted'
import { deriveOperatingMode, validateHostedConfig } from '@open-pencil/core/hosted'
```

- `HostedFeatureFlags` — the three boolean gates.
- `HostedEnvironmentConfig` — full environment contract including flags and URLs.
- `deriveOperatingMode(flags)` — maps a flag set to an operating mode label.
- `validateHostedConfig(config)` — returns violations array; empty means valid.

### `src/app/hosted/flags.ts` (app runtime resolution) <!-- oc:id=sec_ak -->

```ts
import { getHostedConfig, isHostedAuthEnabled, isHostedDocsEnabled, isHostedCollabEnabled, isHostedMode, getOperatingMode } from '@/app/hosted/flags'
```

- `getHostedConfig()` — resolves the full config for the current Vite environment (cached).
- `isHostedAuthEnabled()` / `isHostedDocsEnabled()` / `isHostedCollabEnabled()` — individual gate checks.
- `isHostedMode()` — true when any hosted feature is enabled.
- `getOperatingMode()` — returns the operating mode string.

## Canonical Topology File <!-- oc:id=sec_al -->

`config/hosted-topology.json` is the machine-readable source of truth for the environment matrix, env var contract, and rollout order. It is aligned with `.ch5/environments.yaml` and can be consumed by CI, deploy scripts, and Worker runtime config.

## Rollout Order <!-- oc:id=sec_am -->

1. `hostedAuth` — session verification, route guards, unauthenticated local flows preserved. <!-- oc:id=item_aa -->
1. `hostedDocs` — single-user document storage, import/promote flows. <!-- oc:id=item_ab -->
1. `hostedCollab` — Durable Object room transport (deferred until task 12). <!-- oc:id=item_ac -->

Each flag can be enabled independently through env var overrides without rebuilding the app.