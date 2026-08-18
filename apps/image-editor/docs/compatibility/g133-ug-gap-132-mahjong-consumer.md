# G133 / UG-GAP-132 Mahjong Consumer Evidence

Status: `UNKNOWN`

Scope: missing asset references in the Mahjong editor archive consumer.

## Observed source boundary

- `parseArchive` requires an archive document and asset object, then parses the
  document and restores the serialized assets independently.
- `parseEditorDocument` validates layer and parent references, but does not
  verify image `assetId` or `maskAssetId` values against the archive asset map.
- `EditorAssetRegistry.restore` validates each supplied asset, but does not
  reject document references that are absent from that map.
- A missing image asset fails later during rendering with an untyped
  `Missing editor image asset` error. That late failure is not archive
  admission evidence and does not protect masks before consumption.

## Measurement result

No exact seeded missing-reference scenario was observed in this worker tree.

| Signal | Result | Reason |
|---|---|---|
| Archive rejects missing image reference | `UNKNOWN` | No archive-level reference validation or typed error |
| Archive rejects missing mask reference | `UNKNOWN` | Document and assets are validated independently |
| Seeded defect fails before fix | `UNKNOWN` | No seeded missing-reference harness was observed |
| Nonzero scenario/output evidence | `UNKNOWN` | Scenario count and output count are both zero |
| Consuming editor effect | `UNKNOWN` | No named browser receipt exercised malformed archive import |

The worker checkout and `origin/main` both identified
`a166628fce1abaf7b14bc0bdec1d47ae6a1f2e71`; the observed Node runtime was
`v26.5.0`. No G133 launch receipt exists in this worker checkout, and
dependencies are absent, so test, typecheck, lint, browser, device, and
external-editor proof remain unobserved.

## Acceptance boundary

The gap remains open. Acceptance requires archive admission to enumerate every
non-null image and mask reference, reject the first missing asset with a stable
typed code, preserve the last valid document, and produce a seeded before-fix
failure plus nonzero scenario/output counts under exact commit and runtime
identity. A later renderer exception is not a substitute.
