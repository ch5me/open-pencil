---
title: Hosted Operating Modes
description: Code-facing contract for OpenPencil's ELF-hosted transition.
---

# Hosted Operating Modes

This contract defines OpenPencil's hosted-readiness vocabulary. Downstream auth, storage, collaboration, and rollout work must use these names and ownership rules unless this document is updated first.

OpenPencil remains local-first. Hosted modes add authenticated identity, cloud document records, and hosted collaboration only when explicitly enabled. They must not remove local `.fig` and `.pen` editing, local saves, browser downloads, or desktop file handles.

## Non-goals

- No billing, organization, workspace, comments, broad permissions matrix, or full history product surface.
- No enabled desktop hosted auth rollout in this contract; only the gated deep-link and bearer-storage seam is in scope.
- No hosted runtime code in local-only paths.
- No public-broker Trystero dependency in hosted collaboration mode.

## Federation Adoption Contract

The federation adoption surface is locked to two caller shapes:

- Browser sign-in: `/login` starts the ELF authorize redirect, `/auth/callback` exchanges the code through the OpenPencil API, and the app establishes a cookie-backed session before entering hosted routes.
- Desktop sign-in: Tauri remains local-first in this phase. The callback transport shape is fixed now so later rollout work reuses the same seam: the desktop app reserves the `openpencil://...` deep-link shape, forwards callback URLs through `registerDesktopAuthCallback()`, and keeps any future bearer fallback inside the gated desktop store boundary once hosted desktop auth is explicitly enabled.

Rules:

- Browser remains cookie-first. Desktop/native/API callers may use bearer only at the explicit native boundary.
- The desktop deep-link seam must stay disabled by default; locking the contract does not enable hosted desktop auth.
- Desktop hosted auth must not change local file open/save behavior when the gate is off.
- Browser and desktop callback payloads must converge on the same OpenPencil API session contract: one verified ELF identity, conflict rejection when cookie and bearer disagree.

## Operating Modes

### `local-only`

Current default mode for browser and desktop editing.

- Auth: none.
- Document authority: in-memory editor graph plus local source state.
- Writable sources: File System Access handle, Tauri file path, or browser download name.
- Routing: `/`, `/demo`, and existing local share route behavior may exist, but no hosted document route is required.
- Collaboration: optional current peer-to-peer room, if user shares a room. Room ID is local-share identity only, not hosted identity.
- Ownership: the local operator controls the file. No `user.id`, hosted `document.id`, hosted `room.id`, hosted `asset.id`, or hosted `snapshot.id` is assigned.

### `hosted-auth + local-docs`

Authenticated shell with local document storage still authoritative.

- Auth: cookie-first web session from ELF; bearer token accepted only for non-browser/native/API callers. Cookie and bearer identities must match when both are present.
- Document authority: local source state remains authoritative.
- Writable sources: same as `local-only`.
- Routing: hosted auth gates may wrap the app, but document URLs still open local/untitled documents unless a hosted document ID is present.
- Collaboration: current local-share behavior only; no hosted Durable Object room.
- Ownership: authenticated `user.id` is known, but local documents are not owned by that user until promoted to hosted docs.

### `hosted-docs single-user`

Authenticated hosted document storage without live multi-user editing.

- Auth: same cookie-first web / bearer non-browser rule.
- Document authority: hosted `document.id` is authoritative after import or creation. Local editor state is a working copy of hosted content.
- Writable sources: hosted save writes document metadata and latest snapshot; local Save As / export remains available and does not detach hosted ownership unless user chooses a local-only copy flow.
- Routing: hosted document route must be distinct from local share route, e.g. `/docs/:documentId`. `/share/:roomId` remains legacy/local-share until hosted collaboration replaces it.
- Collaboration: disabled or single-user awareness only. No remote peer mutation channel.
- Ownership: exactly one owner user owns the document. Access model is owner-only for this wave.

### `hosted-collab`

Authenticated hosted document storage plus hosted real-time collaboration.

- Auth: same cookie-first web / bearer non-browser rule for every document API and room connection.
- Document authority: hosted `document.id` plus room state and snapshots. Durable Object room coordinates live Yjs state; snapshots remain document history checkpoints, not a full version-history product.
- Writable sources: hosted save/snapshot path is primary. Local export/save remains an explicit copy/export action.
- Routing: collaboration uses hosted document URL and optional room join affordance; hosted room ID must not be accepted as a substitute for document ID in user-facing routes.
- Collaboration: hosted transport replaces public Trystero signaling. Existing Yjs graph/awareness model can remain the state model behind the hosted transport.
- Ownership: document owner can open the room. Broader sharing/membership is out of scope for this contract and must not be invented in task 1.

## Canonical Identities

All hosted IDs are opaque, stable strings. UI may show document names, file names, or share labels, but code must not use names as identity.

| Object | Canonical field | Authority | Required in modes | Rules |
|---|---|---|---|---|
| `user` | `user.id` | ELF verified session subject normalized by OpenPencil API | `hosted-auth + local-docs`, `hosted-docs single-user`, `hosted-collab` | Stable per ELF account. Never derived from email, display name, local collab name, or provider-specific display fields. Public docs use `ELF`, not `Kilo` or `Firefly`, for this auth identity. |
| `document` | `document.id` | OpenPencil hosted document service | `hosted-docs single-user`, `hosted-collab` | Minted once on hosted create/import/promote. Stable across renames, local exports, snapshots, and room reconnects. Not equal to file path, file handle, download name, Figma node ID, tab ID, or room ID. |
| `room` | `room.id` | Deterministic derivation from hosted `document.id` | `hosted-collab` | Never random in hosted mode. Never user-entered. See room derivation. |
| `asset` | `asset.id` | OpenPencil hosted asset service | `hosted-docs single-user`, `hosted-collab` when binary assets are externalized | Opaque ID for binary blobs such as images. Owned through parent `document.id`; not globally browseable. Content hash may support dedupe but is not the public ID. |
| `snapshot` | `snapshot.id` | OpenPencil hosted document service | `hosted-docs single-user`, `hosted-collab` | Opaque checkpoint ID for serialized document state. Belongs to one `document.id`; not a route identity and not a room identity. |

## Ownership Rules

- `user.id` owns `document.id` in hosted single-user work.
- `document.id` owns its `asset.id` and `snapshot.id` records.
- `room.id` is owned by exactly one `document.id` because it is derived from that document ID.
- Local source state owns nothing hosted until explicit promote/import succeeds.
- Local file names and document names are metadata only. Rename never changes hosted IDs.
- Current peer display names in awareness are presence metadata only. They never become `user.id`.

## Room Identity Derivation

Hosted room ID does not equal hosted document ID. It derives deterministically from hosted document ID so room identity is stable but namespaced away from document routes and storage keys.

Canonical derivation:

```ts
room.id = `op_room_${base32url(sha256(`openpencil:hosted-room:v1:${document.id}`)).slice(0, 32)}`
```

Rules:

- Input must be the canonical hosted `document.id` string exactly as stored.
- Salt string `openpencil:hosted-room:v1:` is part of the contract. Increment only with an explicit migration.
- Output must use lowercase unpadded base32url characters and prefix `op_room_`.
- Hosted room routes and APIs must accept `document.id` as caller-facing identity, then derive `room.id` server-side.
- Existing `generateRoomId()` and `/share/:roomId` remain local-share only until replaced by hosted collaboration.

## Local-to-Hosted Mapping

Current local source fields are:

- File handle: browser File System Access source for `.fig`.
- File path: Tauri disk path for `.fig`.
- Download name: browser fallback name for exported `.fig`.
- Document name: editable display name derived from file name or user rename.
- Tab ID: local UI tab identity only.

Hosted mapping rules:

| Local source | Promote/import action | Hosted result | Local behavior after success |
|---|---|---|---|
| Untitled in-memory document | Create hosted document | Mint `document.id`, first `snapshot.id`, optional `asset.id` records | Keep editing current graph; Save targets hosted doc; local export still available. |
| `.fig` file from File System Access handle | Import hosted document from parsed graph and original file metadata | Mint `document.id`; store source format `fig`; create first `snapshot.id`; externalize binary assets as needed | Preserve local handle for Save As/export only if UI keeps it; hosted document becomes primary save target. |
| `.fig` file from Tauri path | Same as File System Access import | Same as above | Preserve path only as local source metadata; hosted save must not overwrite disk unless user requests local save. |
| `.pen` file via IO registry | Import hosted document from normalized SceneGraph plus source format `pen` | Mint `document.id`; create first `snapshot.id`; convert/normalize assets into hosted `asset.id` records as needed | Hosted document becomes primary save target; local `.pen` path/name remains import provenance. |
| Browser download-only document | Promote current graph | Mint `document.id`; create first `snapshot.id` | Existing download name remains export fallback; hosted document becomes primary save target. |

Promotion must be explicit. Opening a local `.fig` or `.pen` while authenticated must not silently upload the document. The UI may offer "Save to ELF" / "Promote to hosted" after auth is available.

## Route and Source Alignment

- Current `/share/:roomId` represents local peer-to-peer room identity. It is not a hosted document route.
- Hosted document URLs should key by `document.id`, not `room.id`.
- Hosted collaboration should join by `document.id` and derive `room.id` internally.
- Source state must grow a hosted source variant before task 4 implementation: local source fields remain valid, and hosted source fields add `document.id`, latest `snapshot.id`, and source format/provenance.
- Auth/session resolver belongs at hosted boundaries. Browser requests use cookies first; native/API requests use bearer. Conflict means reject, not prefer.

## Hosted Document D1 Model

The hosted document service stores metadata in D1 and binary bytes in R2. D1 rows must never contain serialized `.fig` / `.pen` document bytes or embedded asset bytes.

Runtime bindings from `.ch5/services.yaml`:

- `DB`: D1 metadata database.
- `DOCUMENTS`: R2 bucket for serialized document snapshots.
- `ASSETS`: R2 bucket for binary assets externalized from document graphs.

Application schema lives in `api/src/documents/schema.ts`; the first D1 migration is `api/migrations/0001_hosted_documents.sql`.

### Entities and fields

#### `hosted_documents`

- `id`: hosted `document.id`; opaque primary key minted on explicit hosted create/import/promote/duplicate.
- `owner_user_id`: owner `user.id` from verified ELF session. Required. Single-user owner-only access in this wave.
- `title`: display name only; rename does not change identity.
- `source_format`: normalized document source format, currently `fig` or `pen`.
- `current_snapshot_id`: latest `snapshot.id` for open/save.
- `current_snapshot_storage_key`: R2 key in `DOCUMENTS` for the current snapshot.
- `lifecycle_state`: `active` or `archived`; no deletion product semantics in this wave.
- `created_at`, `updated_at`: service timestamps.

#### `hosted_snapshots`

- `id`: hosted `snapshot.id`; opaque checkpoint ID.
- `document_id`: owning hosted `document.id`.
- `owner_user_id`: denormalized owner `user.id` for owner-scoped queries and invariants.
- `parent_snapshot_id`: previous snapshot lineage pointer, nullable for first import/create.
- `storage_key`: R2 key in `DOCUMENTS`; canonical shape is `documents/{document.id}/snapshots/{snapshot.id}.fig`.
- `byte_length`: serialized snapshot byte length; must be positive.
- `content_hash`: snapshot content hash for integrity/dedupe checks.
- `reason`: `initial-import`, `manual-save`, `autosave`, or `duplicate`.
- `created_at`: service timestamp.

#### `hosted_assets`

- `id`: hosted `asset.id`; opaque binary asset ID.
- `document_id`: owning hosted `document.id`.
- `owner_user_id`: denormalized owner `user.id`.
- `snapshot_id`: snapshot that first referenced or materialized the asset.
- `kind`: `image`, `font`, or `binary`.
- `storage_key`: R2 key in `ASSETS`; canonical shape is `documents/{document.id}/assets/{asset.id}`.
- `content_hash`: asset content hash for integrity/dedupe checks.
- `byte_length`: asset byte length; must be positive.
- `media_type`: MIME type or `application/octet-stream` when unknown.
- `created_at`: service timestamp.

#### `hosted_document_migrations`

- `id`: migration record ID, scoped to document and initial snapshot.
- `document_id`: hosted `document.id` created or duplicated by the transition.
- `owner_user_id`: owner `user.id` that authorized the explicit transition.
- `kind`: `create-empty`, `import-local`, `promote-local`, or `duplicate-hosted`.
- `source_kind`: `untitled-memory`, `browser-file-handle`, `tauri-file-path`, `browser-download`, `io-registry`, or `hosted-document`.
- `source_format`: `fig` or `pen`.
- `source_name`: local file/download/display name when available. Metadata only.
- `source_fingerprint`: local provenance fingerprint when available. Metadata only; never identity.
- `initial_snapshot_id`: first hosted `snapshot.id` written for the transition.
- `state`: `pending`, `complete`, or `failed`.
- `error_code`: explicit typed failure code when state is `failed`.
- `created_at`, `completed_at`: service timestamps.

### R2 key rules

- Snapshot bytes go to `DOCUMENTS` at `documents/{document.id}/snapshots/{snapshot.id}.fig` after the graph is normalized to hosted snapshot bytes.
- Asset bytes go to `ASSETS` at `documents/{document.id}/assets/{asset.id}`.
- R2 keys are derived only from hosted IDs minted by the hosted service, not local paths, names, room IDs, tab IDs, or Figma node IDs.
- D1 metadata creation must be paired with planned R2 writes by the hosted runtime. Task 7 models the metadata contract; task 11 implements the full CRUD/storage transaction path.

## Local-to-Hosted Transition Rules

Legal transitions are explicit and testable through `createHostedDocumentMetadata()` in `api/src/documents/migration.ts`.

| Transition | Input | Required session | Metadata result | Notes |
|---|---|---|---|---|
| `create-empty` | Untitled in-memory graph | `user.id` | New `document.id`, first `snapshot.id`, migration `source_kind = untitled-memory` | Used for hosted new document. |
| `import-local` | Parsed `.fig` or normalized `.pen` source | `user.id` | New `document.id`, first `snapshot.id`, optional `asset.id` rows, migration provenance | Used when user chooses hosted import from a local file/import registry. |
| `promote-local` | Current local working graph plus source metadata | `user.id` | New `document.id`, first `snapshot.id`, optional `asset.id` rows, migration provenance | Used by future `Save to ELF` / promote flow. Local file handle/path remains provenance only. |
| `duplicate-hosted` | Existing hosted document snapshot bytes | `user.id` | New `document.id`, copied first `snapshot.id`, migration `source_kind = hosted-document` | Creates owner-scoped hosted copy; no broad sharing semantics. |

Unsupported transitions must fail before any partial D1 record is considered valid:

- Missing `user.id` -> `missing-owner`.
- Source format other than `fig` or `pen` -> `unsupported-source-format`.
- No initial snapshot bytes -> `missing-snapshot-bytes`.
- Local import/promote without source name or fingerprint provenance -> `missing-source-metadata`.
- Asset metadata without content hash, positive byte length, and media type -> `missing-asset-metadata`.
- Local file open while authenticated -> hosted upload is illegal; remain local until explicit `import-local` or `promote-local`.
- Hosted room join by user-entered/random room ID -> illegal; hosted collaboration joins by `document.id` and derives `room.id` server-side.
- Hosted document identity derived from path/name/download name -> illegal; `document.id` is minted only by the hosted service.

The D1 schema deliberately omits organization IDs, group ACL rows, comments, and broad permissions. Owner-only access is the only supported hosted document authorization model in this phase.

## Document Backend Contract

App document I/O routes through a `DocumentBackend` seam before any hosted runtime is wired. Backends advertise legal operations and capabilities so local file helpers do not learn hosted API details.

Backend operations:

| Operation | Local file backend | Hosted document backend |
|---|---|---|
| `open` | Legal for local `.fig` file open and reload from current file handle/path. | Legal only by hosted `document.id`; local file input is rejected to prevent silent upload. |
| `save` | Legal. Writes File System Access handle, Tauri path, or browser download fallback with existing behavior. | Legal. Writes hosted metadata and latest snapshot through future hosted runtime. |
| `saveAs` | Legal. Chooses Tauri path, File System Access handle, or browser download prompt. | Legal. Creates explicit hosted copy/import target through future hosted runtime; local export stays separate. |
| `autosave` | Legal only when current source has File System Access handle or Tauri path. | Legal only when hosted `document.id` exists and hosted runtime is available. |
| `loadMetadata` | Legal. Returns local file path, handle name, download name, and display name. | Legal. Returns hosted `document.id`, latest `snapshot.id`, source format, and display name. |

Backend capabilities:

| Capability | `local-only` and `hosted-auth + local-docs` | `hosted-docs single-user` and `hosted-collab` |
|---|---|---|
| `localFileOpen` | Supported. | Not supported by hosted backend; use explicit import/promote flow. |
| `localFileSave` | Supported for handle/path writes; browser download fallback remains explicit Save. | Not supported by hosted backend primary save. Local export/copy remains separate UI action. |
| `browserDownloadFallback` | Supported. | Supported only as explicit export/copy, not hosted primary save. |
| `hostedOpen` | Not supported. | Supported through hosted runtime by `document.id`. |
| `hostedSave` | Not supported. | Supported through hosted runtime by `document.id`. |
| `hostedAutosave` | Not supported. | Supported through hosted runtime by `document.id`. |
| `metadataLoad` | Supported. | Supported. |

Illegal-operation errors are typed as `DocumentBackendOperationError` with `code`, `backendId`, `mode`, and `operation`. Missing hosted runtime returns `hosted-runtime-unavailable`; missing local or hosted source returns `missing-source`; mode/capability mismatches return `illegal-operation` or `missing-capability`.

## Transition Order

Allowed mode transitions:

1. `local-only` -> `hosted-auth + local-docs`: sign in, keep local docs unchanged.
2. `hosted-auth + local-docs` -> `hosted-docs single-user`: explicit import/promote or hosted create.
3. `hosted-docs single-user` -> `hosted-collab`: enable hosted room for existing `document.id`.
4. Any hosted mode -> local export/copy: export `.fig` or `.pen` without deleting hosted identity.

Disallowed transitions:

- Local file open -> automatic hosted upload.
- Hosted room join by random or user-entered room ID.
- Hosted document identity derived from local file path/name.
- Hosted room ID reused as document ID.
