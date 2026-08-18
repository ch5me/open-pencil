# G146 / UG-GAP-145 Consuming Typography Evidence

Status: `UNKNOWN`

Scope: OpenPencil typography and text-layout behavior on the Mahjong image-editor
consuming surface.

## Observed local contracts

- Mahjong consumes `@open-pencil/core` as a producer contract and records
  `openPencilCore: 0.13.2` in
  `spikes/three-compositor-react/src/editor/producer-compatibility.ts`.
- The consumer compatibility module projects scene-graph nodes into the layer
  tree. It does not project `TEXT` node content, style runs, font features,
  font variations, direction, wrapping, max-lines, or measured layout.
- The active raster consumer draws text through
  `CanvasRenderingContext2D.fillText` in
  `src/app/rendering/editor-asset-registry.ts`.
- That raster path sets family, weight, size, alignment, and a width bound. It
  does not consume OpenPencil paragraph layout, style runs, direction,
  font-variation/features, truncation, or measured line boxes.
- PSD import translates a single PSD text style into the legacy Mahjong
  `TextLayer` shape in `src/app/adapters/editor-psd.ts`; this is an import
  projection, not OpenPencil text-layout execution.
- Existing consumer proof covers compositor loading, geometry, layer-tree
  projection, and raster fallback. No test covers OpenPencil text shaping,
  multiline layout, mixed style runs, or save/reopen typography parity.

## Consuming matrix

| Surface | Result | Exact boundary |
|---|---|---|
| OpenPencil text node appears in Mahjong | `UNKNOWN` | No consuming fixture or browser artifact proves a producer `TEXT` node renders |
| Multiline wrapping and line-height | `UNKNOWN` | Canvas2D `fillText` receives one string; no line-box or paragraph-layout proof |
| Mixed style runs | `UNKNOWN` | Consumer `TextLayer` has one family/size/weight/color tuple; no style-run projection |
| Direction and complex-script shaping | `UNKNOWN` | No direction/shaping adapter or Arabic/Indic/Hebrew consuming artifact |
| Font features and variations | `UNKNOWN` | Consumer raster key and draw path do not carry OpenPencil feature/variation fields |
| Max-lines and truncation | `UNKNOWN` | No consumer fields or acceptance test |
| Edit, save, reopen typography parity | `UNKNOWN` | Persistence tests cover legacy document records, not OpenPencil text-layout state |

## Exact tried list

1. Searched Mahjong source, tests, scripts, and compatibility docs for
   OpenPencil, typography, text-layout, font shaping, style runs, line-height,
   direction, wrapping, and max-lines.
2. Inspected `spikes/three-compositor-react/src/editor/producer-compatibility.ts`
   and its tests.
3. Inspected `src/app/rendering/editor-asset-registry.ts`,
   `src/app/adapters/editor-psd.ts`, `src/app/model/editor-document.ts`, and
   related persistence tests.
4. Inspected package metadata: Mahjong pins `@open-pencil/core` at `0.13.2`;
   the producer compatibility object records the same version.
5. Checked existing `docs/image-editor/compatibility` records; prior records
   establish typed `UNKNOWN` boundaries when consuming effects lack artifacts.

## Verification

- Consumer-focused source inspection: `PASS`.
- JSON/document structure: `PASS` for this Markdown-only evidence record.
- Typography consuming effect: `UNKNOWN`; no browser or external-renderer artifact
  was produced.
- Full typecheck, lint, and E2E: not run for this docs-only audit; they do not
  turn absent consuming evidence into a pass.

## Acceptance boundary

Producer scene-graph types, package version, Canvas2D API presence, PSD import
metadata, and synthetic unit tests do not prove consuming typography. Close
UG-GAP-145 only with a fresh identity-bound Mahjong artifact that imports or
constructs OpenPencil `TEXT` nodes and demonstrates single-line, multiline,
mixed-run, non-Latin shaping, and save/reopen parity on the actual consuming
surface.
