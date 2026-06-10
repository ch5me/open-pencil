---
title: Second-Cohort Federation Compatibility Surface
description: How to plug a second-cohort CH5 ELF sub-app into the OpenPencil hosted federation.
---

# Second-Cohort Federation Compatibility Surface <!-- oc:id=sec_aa -->

This document is the integration guide for any **second-cohort** sub-app that wants to plug into the CH5 ELF federation that OpenPencil (the first-cohort sub-app) already speaks.

The "compatibility surface" is the public, versioned, type-checked contract that any sub-app consumes to integrate without depending on Cloudflare Worker internals or copying private type definitions. It is implemented in the [`@open-pencil/federation`](https://github.com/open-pencil/open-pencil/tree/main/packages/federation) workspace package and semver-locked via the `FEDERATION_SURFACE_VERSION` constant.

## Who is this for <!-- oc:id=sec_ab -->

You are integrating a second-cohort sub-app — a Folio, palot, or any future CH5 sub-app — that wants to:

- Authenticate end users with ELF (cookie-first web, bearer for non-browser callers).
- Read and write hosted documents against the OpenPencil API Worker.
- Upload and delete binary assets (images, fonts) bound to a hosted snapshot.
- Join a hosted real-time collaboration room backed by a Durable Object.

You do **not** need to depend on `@cloudflare/workers-types`, on the `api/` source, or on the `trystero` signaling path. Everything you need is in `@open-pencil/federation`.

## What's in the surface <!-- oc:id=sec_ac -->

| Subpath | What you get |
|---|---|
| `@open-pencil/federation` | Full barrel: types, wire helpers, client factory, errors, surface version. |
| `@open-pencil/federation/types` | Public identity, document, session, wire, and feature-flag types. |
| `@open-pencil/federation/wire` | Base64 helpers + the `openpencil-room.v1` envelope parser. |
| `@open-pencil/federation/client` | `SessionClient`, `DocumentClient`, `AssetClient`, `RoomClient`, `connectHostedRoom`, and the `createFederationClient` factory. |
| `@open-pencil/federation/errors` | `FederationError`, `HostedApiError`, `SessionError`, `RoomError`, `DocumentBackendOperationError`. |

## Surface version <!-- oc:id=sec_ad -->

Read `FEDERATION_SURFACE_VERSION` to gate behavior on a known surface. Sub-app code should pin to a MAJOR version of `@open-pencil/federation`. See the package README for the full semver rules.

## Quick start <!-- oc:id=sec_ae -->

```ts
import { createFederationClient } from '@open-pencil/federation'

const client = createFederationClient({
  apiOrigin: 'https://api.design.elf.dance',
  getToken: () => readCookie('ELF_JWT') // or any token source
})

const outcome = await client.session.resolve()
if (outcome.type === 'authenticated') {
  const docs = await client.documents.list({ limit: 20 })
  // ...
}
```

For a hosted collab surface (Yjs + awareness over WebSocket):

```ts
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { createFederationClient, connectHostedRoom } from '@open-pencil/federation'

const client = createFederationClient({ apiOrigin, getToken })
const ydoc = new Y.Doc()
const awareness = new Awareness(ydoc)

const connection = await client.rooms.resolveConnection(documentId)
const handle = connectHostedRoom({ ydoc, awareness, connection, onStateChange })

// Later:
handle.leave()
```

## Auth contract <!-- oc:id=sec_af -->

The federation uses **cookie-first web** auth: the OpenPencil API Worker reads the `ELF_JWT` cookie set by the ELF auth flow at `design.elf.dance`. Bearer tokens are accepted as a non-browser fallback (desktop, native, API), and `Sec-WebSocket-Protocol: bearer.<token>` is accepted for WebSocket upgrades.

Sub-app code never mints tokens. The sub-app only consumes the `SessionClient.resolve()` outcome to learn whether a request has a valid session and, if so, who the user is.

JWT payload shape:

```ts
type ElfTokenPayload = {
  elfUserId: string // canonical identity; never parse display fields as identity
  exp: number
  iat: number
}
```

The public payload does not include the issuer, audience, or any internal `kilo*` / `firefly*` fields. See the project's [ELF auth naming doctrine](./elf-auth-naming.md) for the full rename matrix.

## Document API <!-- oc:id=sec_ag -->

`client.documents` is a typed wrapper around the `/api/documents/*` route family. It never throws on missing auth — it surfaces `HostedApiError` with a typed `code` and `status`. The currently stable `code` values are:

- `unauthorized`, `forbidden`, `not-found`, `conflict`
- `missing-snapshot`, `missing-fields`, `empty-snapshot`
- `hosted-runtime-unavailable`, `illegal-operation`, `missing-capability`, `missing-source`
- `unsupported-source-format`, `missing-owner`, `unsupported-transition`
- `missing-source-metadata`, `missing-asset-metadata`, `missing-snapshot-bytes`
- `internal-server-error`

Write operations round-trip bytes as base64 inside JSON. This matches the Hono Worker contract exactly; sub-app code does not need to know about multipart or streaming.

## Room wire protocol <!-- oc:id=sec_ah -->

The hosted room WebSocket uses the `openpencil-room.v1` subprotocol. JSON messages of the form `{ type, data }` where `data` is a base64-encoded binary Yjs/awareness update. The current `type` discriminator values are:

- `yjs-update` — binary Yjs document update
- `awareness` — binary y-protocols/awareness update
- `sync-step1` — Yjs state vector
- `sync-reply` — Yjs state delta in response to a step1
- `room-state` — initial state snapshot

Unknown `type` values are tolerated by both ends and must not throw. Adding a new `type` is a MINOR version change.

The base64 encoding is chunked to avoid blowing the call stack on large Yjs updates. The `encodeBase64` / `decodeBase64` helpers in `@open-pencil/federation/wire` are the canonical implementation.

## Feature flags <!-- oc:id=sec_ai -->

The `HostedEnvironmentConfig` and `HostedFeatureFlags` types tell the sub-app which capabilities are enabled in a given environment. The flags are independently switchable:

- `hostedAuth` — ELF cookie-first session resolution
- `hostedDocs` — hosted document storage (D1 + R2)
- `hostedCollab` — hosted real-time collaboration (Durable Object rooms)

A sub-app that wants to gate a feature on the host's capabilities should read the config, not guess by host. See `src/app/hosted/flags.ts` in OpenPencil for the resolution pattern.

## Operating modes <!-- oc:id=sec_aj -->

Four modes exist, listed in the [hosted-operating-modes contract](./hosted-operating-modes.md). Sub-apps must handle `unauthenticated` as a normal first-visit state, not an error. Local-only mode must remain fully supported even when hosted auth is enabled.

## What is **not** in the surface (yet) <!-- oc:id=sec_ak -->

- **Desktop deep-link auth** — the Web bearer fallback seam is documented but desktop implementations are deferred. Sub-apps that run inside Tauri should not implement bearer token flow yet; cookie-first is the only public auth.
- **Billing, organizations, comments, broad sharing** — explicitly out of scope.
- **Membership / permissions matrix** — hosted documents are owner-only in this phase.

## Stability guarantees <!-- oc:id=sec_al -->

Once `FEDERATION_SURFACE_VERSION` reaches `1.0.0`:

- No exported symbol may be removed or renamed without a MAJOR bump.
- No type may be tightened without a MAJOR bump.
- No wire message `type` may be removed without a MAJOR bump.
- No `OPENPENCIL_ROOM_WS_SUBPROTOCOL` change without a MAJOR bump.

Sub-app code can pin to a MAJOR version and upgrade deliberately.

## Reference <!-- oc:id=sec_am -->

- [Hosted Operating Modes](./hosted-operating-modes.md) — mode semantics and identity rules.
- [Hosted Environment Topology](./hosted-environment-topology.md) — env URLs and feature gates.
- [ELF Auth Naming Doctrine](./elf-auth-naming.md) — public/internal naming rules.
- `packages/federation/README.md` — package reference.