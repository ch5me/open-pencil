---
title: ELF Auth Naming Doctrine
description: Public/internal naming contract for OpenPencil's ELF federation auth surfaces.
---

# ELF Auth Naming Doctrine

This contract defines auth naming for OpenPencil's ELF-hosted transition. Naming is part of the federation API contract, not copy polish.

## Doctrine

- Public and external federation auth surfaces use `ELF` / `Elf` / `elf` naming.
- `@ch5me/elf-auth-client` is the only public package name for sub-app auth verification.
- `elfUserId` is the only public JWT payload identity field consumed by OpenPencil.
- `Kilo` names are legacy upstream-auth names. They must not appear in new public token, key, endpoint, package, payload, header, or env-var surfaces.
- `Firefly` names are allowed only for internal platform implementation surfaces, repo/package names, database columns, and worker code that are not exposed as sub-app auth contracts.
- Internal `fireflyUserId` or `firefly_user_id` names may remain only inside Firefly-owned storage or service internals. They must be translated to/from `elfUserId` at the public auth boundary.

## Public Surface Rules

| Surface | Canonical public naming | Rule |
|---|---|---|
| Package | `@ch5me/elf-auth-client` | Published package consumed by OpenPencil and other sub-apps. No unscoped `elf-auth-client`, no `kilo-auth-client`. |
| Verifier API | `createElfVerifier`, `ElfVerifierOptions`, `ElfTokenPayload` | Public SDK exports use ELF vocabulary. Legacy `createKiloVerifier` names are compatibility debt only. |
| JWT identity field | `elfUserId` | Only accepted public user identity field. Reject `kiloUserId` and `fireflyUserId` in canonical schema. |
| JWT token name | `ELF JWT` or `ELF federation token` | Do not call sub-app tokens `Kilo JWT` in public integration docs. |
| JWKS endpoint | `https://api.elf.dance/.well-known/jwks.json` | Discovery endpoint stays host/path based; docs call it ELF JWKS. |
| Token mint endpoints | `/api/elf-auth/token`, `/api/elf-auth/refresh`, `/api/elf-auth/verify` | New public endpoints use `elf-auth`. Existing `/api/kilo-auth/*` may redirect or proxy during migration only. |
| Device auth env var | `ELF_JWT` | Do not add new `KILO_JWT` runtime inputs. Existing `KILO_JWT` may be read as deprecated alias during migration. |
| User-id headers | `X-CH5-Elf-User-Id` | New sub-app/platform headers use Elf. Existing `X-CH5-Kilo-User-Id` may be accepted as deprecated alias at ingress only. |
| Attribution field | `elf_user_id` | New telemetry/billing payloads use `elf_user_id`; legacy `kilo_user_id` is migration debt. |
| Cookie/session names | `<subapp>-elf-session` or app-local neutral names | No new `kilo-*` public cookie names. Internal framework cookies may keep framework names if not public contract. |
| Signing key names | `ELF_JWT_PRIVATE_KEY`, `ELF_JWT_KEY_ID`, `ELF_JWKS_URL` | No new `KILO_*` public signing-key env vars. |
| Docs and UI copy | `Sign in with ELF`, `ELF auth`, `ELF account` | Do not ship new public `Sign in with Kilo` copy. |

## Rename Matrix

| Current / legacy surface | Canonical surface | Scope | Compatibility / deprecation rule |
|---|---|---|---|
| `@kilocode/worker-utils` as sub-app verifier package | `@ch5me/elf-auth-client` | Package | Do not use for OpenPencil federation. Firefly internals may keep upstream dependency until they expose a sub-app auth boundary. |
| `elf-auth-client` unscoped local package | `@ch5me/elf-auth-client` | Package | Deprecated. No new consumers. Existing consumers migrate to scoped semver package. |
| `createKiloVerifier` | `createElfVerifier` | SDK export | Do not add to public package. If any consumer still imports it, add a short-lived local adapter in that consumer, not in OpenPencil. |
| `KiloTokenPayload` | `ElfTokenPayload` | SDK type | Deprecated public name. Package contract exposes only `ElfTokenPayload`. |
| `kiloTokenPayload` | `elfTokenPayloadSchema` | SDK schema | Deprecated public name. Canonical schema rejects legacy identity fields. |
| `kiloUserId` | `elfUserId` | JWT payload | Breaking rename at public auth boundary. Do not dual-accept in canonical schema. Migration belongs at token issuer or legacy ingress adapter. |
| `fireflyUserId` | `elfUserId` | JWT payload | Public payload field deprecated. Internal Firefly storage may keep `fireflyUserId` / `firefly_user_id` after translating from `elfUserId`. |
| `Kilo JWT` | `ELF JWT` / `ELF federation token` | Docs/token name | Replace in public sub-app docs. Historical notes may keep `Kilo` if explicitly marked legacy. |
| `/api/kilo-auth/token` | `/api/elf-auth/token` | Endpoint | New callers use `elf-auth`. Legacy path may 307/proxy with deprecation warning until cutover window ends. |
| `/api/kilo-auth/refresh` | `/api/elf-auth/refresh` | Endpoint | Same as token endpoint. |
| `/api/kilo-auth/verify` | `/api/elf-auth/verify` | Endpoint | Same as token endpoint; verifier package remains preferred for sub-app local verification. |
| `KILO_JWT` | `ELF_JWT` | Env var / token name | Accept `KILO_JWT` as deprecated alias only in migration wrappers. New docs, templates, and Hush targets use `ELF_JWT`. |
| `kilo_jwt` | `elf_jwt` | Credential file key | Read legacy key only during migration; write `elf_jwt`. |
| `kilo_user_id` | `elf_user_id` | Credential/telemetry field | Public telemetry and credential payloads write `elf_user_id`. Legacy `kilo_user_id` read-only alias during migration. |
| `X-CH5-Kilo-User-Id` | `X-CH5-Elf-User-Id` | HTTP header | New platform/sub-app hops emit Elf header. Ingress may map Kilo header to Elf header and log deprecation. |
| `KILO_TOKEN_VERSION` | `ELF_TOKEN_VERSION` or literal `version: 3` | Token/key constant | Public docs use ELF name or schema literal. Internal upstream constants can remain private. |
| `KILOCLAW_AUTH_COOKIE` / `kiloclaw-auth` | Internal worker access cookie | Cookie | Not part of OpenPencil/ELF federation. Do not rename unless that worker exposes it as public ELF auth. |
| `kilocode_users` / `api_token_pepper` | Internal Firefly storage | DB/key | Preserve as implementation detail unless platform storage migration explicitly renames it. Public payload remains `elfUserId`. |
| `Sign in with Kilo` | `Sign in with ELF` | UI/docs | Public copy must use ELF. Historical implementation plans may retain Kilo only inside marked stale sections. |

## Compatibility Rules

- Public SDK schema stays strict: canonical `@ch5me/elf-auth-client` accepts `elfUserId` only.
- Compatibility aliases live at migration edges: legacy endpoint redirects, ingress header mapping, or old credential-file readers.
- New OpenPencil code must not emit Kilo-named public auth fields, headers, env vars, endpoint paths, token names, or package imports.
- Internal Firefly names must be documented as internal when referenced from OpenPencil readiness docs.
- Deprecation adapters must be one-way: read legacy, write canonical ELF.
- Any legacy alias must have a removal owner and be visible in cutover docs before production enablement.

## Inventory Scope

Task 3 audited only authoritative auth contract surfaces:

- `firefly-cloud/docs/elf-auth-topology.md`
- `firefly-cloud/docs/firefly-cutover-runbook.md`
- `ch5-company/elf-auth-cutover-spec.md`
- `ch5-company/ch5-platform-package-catalog.md`
- `ch5-company/wiki/topics/elf-federation-telemetry-and-billing-attribution.md`
- `ch5-packages/packages/auth/elf-auth-client/src/types.ts`
- `ch5-packages/packages/auth/elf-auth-client/README.md`
- `open-pencil/AGENTS.md`
- `open-pencil/packages/docs/development/hosted-operating-modes.md`

Archive docs, historical plans, internal Firefly runtime names, and unrelated product code are out of scope for this naming doctrine unless they become public auth integration contracts.
