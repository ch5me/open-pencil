# `@open-pencil/federation` <!-- oc:id=sec_aa -->

> The public, versioned, type-checked compatibility surface for second-cohort CH5 ELF sub-app federation.

This package is the canonical entry point for any sub-app that wants to plug into the CH5 ELF federation that OpenPencil (the first-cohort sub-app) already speaks. It exposes the hosted API contract and the hosted room WebSocket protocol as a stable, semver-locked surface that can be consumed without depending on the Cloudflare Worker internals.

## What's inside <!-- oc:id=sec_ab -->

| Subpath | Contents |
|---|---|
| `@open-pencil/federation` | The full barrel: types, wire helpers, client factory, errors, surface version. |
| `@open-pencil/federation/types` | Public identity, document, session, wire, and feature-flag types. |
| `@open-pencil/federation/wire` | Base64 helpers + the `openpencil-room.v1` envelope parser. |
| `@open-pencil/federation/client` | `SessionClient`, `DocumentClient`, `AssetClient`, `RoomClient`, `connectHostedRoom`, and the `createFederationClient` factory. |
| `@open-pencil/federation/errors` | `FederationError`, `HostedApiError`, `SessionError`, `RoomError`, `DocumentBackendOperationError`. |

## Surface contract <!-- oc:id=sec_ac -->

The package exports a single constant — `FEDERATION_SURFACE_VERSION` — that semver-locks the public contract:

- **MAJOR** — removing or renaming an exported symbol, tightening a type, changing wire message `type` values, changing the room WebSocket subprotocol.
- **MINOR** — adding a new exported symbol, adding a new optional wire message, adding a new optional API endpoint.
- **PATCH** — docs or implementation-only changes that do not affect shape.

Sub-app consumers can pin to a MAJOR version. Once `1.0.0` is shipped, no breaking changes may land without a MAJOR bump.

## Quick start <!-- oc:id=sec_ad -->

```ts
import { createFederationClient } from '@open-pencil/federation'

const client = createFederationClient({
  apiOrigin: 'https://api.design.elf.dance',
  getToken: () => localStorage.getItem('ELF_JWT')
})

const outcome = await client.session.resolve()
if (outcome.type === 'authenticated') {
  const docs = await client.documents.list()
  // ...
}
```

For hosted collab:

```ts
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { createFederationClient, connectHostedRoom } from '@open-pencil/federation'

const client = createFederationClient({ apiOrigin, getToken })
const ydoc = new Y.Doc()
const awareness = new Awareness(ydoc)

const connection = await client.rooms.resolveConnection(documentId)
const handle = connectHostedRoom({ ydoc, awareness, connection })
```

## ELF naming doctrine <!-- oc:id=sec_ae -->

This package follows the project's ELF public naming doctrine: all public types, headers, and payload fields use the `elf` / `ELF` namespace. Internal Firefly names do not leak. See `packages/docs/development/elf-auth-naming.md` for the full rename matrix.

## Version <!-- oc:id=sec_af -->

The exported `FEDERATION_SURFACE_VERSION` is the source of truth for the public contract. Sub-apps can read it to gate behavior on a known surface version.