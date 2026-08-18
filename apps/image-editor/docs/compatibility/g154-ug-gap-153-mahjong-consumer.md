# G154 / UG-GAP-153 Collaboration, Versioning, and Cloud-Document Audit

Status: `BLOCKED`

Scope: local transaction/autosave/versioning, hosted cloud-document storage,
real-time collaboration, ownership and trust boundaries, deterministic
conflict behavior, and consuming-surface proof across OpenPencil, Mahjong, and
ch5-packages.

## Acceptance contract

`UG-GAP-153` is not accepted until all of these gates pass:

1. One named owner exists for local persistence, hosted documents, and
   collaboration transport; no duplicate authority remains.
2. The trust model and cost envelope are explicit, including authenticated
   document access and bounded update/snapshot retention.
3. Local transactions and autosave have deterministic ordering, failure
   behavior, and durable save/reopen proof.
4. Collaboration conflict/version semantics are deterministic and a 10,000
   concurrent-operation model run converges with zero unauthorized disclosure.
5. Hosted snapshots preserve version/lineage semantics across save, reconnect,
   reopen, and recovery.
6. Exact producer commit/runtime identity and the consuming runtime effect are
   recorded.
7. Browser, physical-device, iOS Safari, Android Chrome, Photoshop, Affinity
   Photo, Krita, and Photopea claims remain `UNKNOWN` unless directly observed.

## Cross-repository evidence

| Gate | OpenPencil | Mahjong | ch5-packages | Verdict |
| --- | --- | --- | --- | --- |
| Local persistence owner | `src/app/document/autosave/create.ts` watches `sceneVersion`; autosave is opt-in and debounced 3 seconds | `src/app/model/editor-persistence-v1.ts` provides version-preserving roots and asset deltas | No image-editor persistence authority found | `PARTIAL` |
| Transaction semantics | Yjs `ydoc.transact` groups graph updates, but no accepted image-editor transaction/version ADR or durable journal proof | `saveEditorPersistence` rejects invalid input before write and retains recoverable roots; no cross-client transaction contract | No image-editor transaction authority | `PARTIAL` |
| Hosted document owner | Hosted API uses D1 metadata plus R2 snapshots/assets; owner checks exist in `api/src/documents/crud.ts` | No hosted document backend | No image-editor cloud-document owner | `PARTIAL` |
| Collaboration transport | Local Trystero/Yjs and hosted Durable Object room paths exist; hosted flag defaults off in production | No collaboration transport | Generic collaboration contracts in Folio docs are not an image-editor consumer | `PARTIAL` |
| Auth and disclosure | E2E source asserts unauthorized room request returns 401; no observed live receipt and no 10,000-client disclosure run | Local persistence has no cloud trust boundary | No image-editor authorization/effect | `PARTIAL` |
| Version/conflict semantics | Yjs CRDT update/reconnect path exists; hosted saves currently write a fresh snapshot with `parent_snapshot_id` null, so deterministic snapshot conflict/version policy is not accepted | Root IDs and `producerTipSetHash` are recorded, but no concurrent merge/conflict contract | Generic Folio conflict contracts are not bound to this editor | `PARTIAL` |
| Autosave/reopen | Local file autosave and hosted backend unit/e2e tests exist; no durable reopen proof on a consuming deployment | Save/reopen model tests pass for local editor roots | No relevant proof | `PARTIAL` |
| 10,000-operation convergence | No model, run artifact, or result found | No model or result found | No image-editor model or result found | `FAIL` |
| Exact identity/effect | Source commits can be recorded below; no consuming runtime receipt in this audit | Source commit can be recorded below; no consuming runtime receipt | No consumer receipt | `UNKNOWN` |
| External applications/devices | Not observed | Not observed | Not observed | `UNKNOWN` |

## Observed boundaries

- OpenPencil collaboration is real source behavior: `src/app/collab/session.ts`
  creates a Y.Doc and IndexedDB persistence per room; `src/app/collab/room.ts`
  transports Yjs updates and awareness over local P2P or hosted WebSocket
  rooms.
- OpenPencil local autosave is real but opt-in:
  `src/app/document/autosave/create.ts` skips when `autosaveEnabled` is false,
  when no writable source exists, or when `sceneVersion` equals the saved
  version. Failure is logged as a warning, not surfaced as a durable typed
  receipt.
- OpenPencil hosted storage has owner-bound D1 metadata and R2 snapshot/assets.
  The CRUD tests cover owner rejection, non-empty snapshots, and snapshot
  metadata. The hosted collaboration E2E source covers two clients,
  unauthorized join, and reconnect, but this audit did not run a live
  consuming deployment.
- Mahjong local persistence is deliberately fail-closed: invalid viewport or
  storage read failure does not write a replacement root, and tests cover
  save/reopen plus 100 deterministic save seeds. This is local model proof,
  not collaboration or cloud proof.
- ch5-packages contains generic collaboration/version contracts for other
  product surfaces. No image-editor authority, adapter, or consuming artifact
  was found; do not promote generic Folio contracts to image-editor proof.

## Exact source identity

| Producer | Commit | Runtime observed |
| --- | --- | --- |
| Mahjong worker tree | `3921081e33bbe8051b848b71981008fcfa8d542f` | Node `v24.14.1`, Bun `1.3.14` |
| OpenPencil checkout | `7e5410ac361b1bea00d2d79d5249ddc227142b94` | Node `v24.14.1`, Bun `1.3.14` |
| ch5-packages checkout | `1b97a5c8b816a449a334160fa5f5a48470ca4ba0` | Node `v24.14.1`, Bun `1.3.14` |

## Exact acceptance result

`UG-GAP-153` stays blocked:

- Ownership/trust/cost decision: `UNKNOWN`; implementation boundaries exist but
  no accepted image-editor ADR binds them.
- Local save/reopen: `PARTIAL`; Mahjong model proof and OpenPencil source/E2E
  tests exist, but no consuming deployed receipt.
- Conflict/version semantics: `PARTIAL`; Yjs convergence machinery and
  snapshot metadata exist, but no accepted deterministic conflict contract.
- Unauthorized disclosure: `UNKNOWN`; source tests assert a 401 path, but no
  live receipt or zero-disclosure model result.
- 10,000 concurrent operations: `FAIL`; no run or artifact found.
- Exact consuming effect: `UNKNOWN`; no browser, device, or external-editor
  observation.

No browser, physical-device, iOS Safari, Android Chrome, Photoshop, Affinity
Photo, Krita, or Photopea behavior is claimed.

## Verification

- Cross-repository source and test inspection: `PASS`.
- Existing Mahjong persistence tests: source evidence present; focused runtime
  execution not completed in this docs-only audit.
- OpenPencil hosted collaboration, autosave, and hosted-storage test sources:
  `PASS` as source evidence only; live consuming execution `UNKNOWN`.
- 10,000-operation convergence, accepted ownership/trust/cost decision, and
  consuming runtime effect: `FAIL` or `UNKNOWN`.
- Full typecheck, lint, and E2E: not run; this is a docs-only fail-closed
  acceptance audit.
