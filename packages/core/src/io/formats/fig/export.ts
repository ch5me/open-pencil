/* eslint-disable max-lines -- FIG export orchestration keeps shared GUID state in one pipeline */
import type { CanvasKit } from 'canvaskit-wasm'
import { deflateSync, inflateSync } from 'fflate'

import { compressFigDataSync } from '@open-pencil/fig'
import { buildComponentPropIndex, stringToGuid } from '@open-pencil/fig/node-change'
import { initCodec, getCompiledSchema, getSchemaBytes } from '@open-pencil/kiwi/fig/codec'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { decodeBinarySchema, compileSchema, ByteBuffer } from '@open-pencil/kiwi/schema-runtime'
import type { SceneGraph, VariableValue } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import { decodeBase64 } from '#core/bytes'
import type { SkiaRenderer } from '#core/canvas'
import { CANVAS_BG_COLOR, IS_BROWSER, IS_TAURI } from '#core/constants'
import {
  canUseRasterExportWorker,
  renderFixedThumbnailViaWorker,
  renderThumbnail
} from '#core/io/formats/raster'
import { IOCancelledError, throwIfIOCancelled } from '#core/io/limits'
import { populateAllLazyFigImportRoots } from '#core/kiwi/fig/lazy-import'
import {
  sceneNodeToKiwi,
  fractionalPosition,
  buildFontDigestMap,
  safeColor,
  makeDocumentNodeChange,
  makeCanvasNodeChange
} from '#core/kiwi/fig/node-change/serialize'
import { deserializeSceneGraph, serializeSceneGraph } from '#core/kiwi/fig/parse/transfer'

const THUMBNAIL_1X1 = decodeBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
)

type KiwiNodeChange = NodeChange & Record<string, unknown>
type FigExportPage = ReturnType<SceneGraph['getPages']>[number]

interface CanvasExportEntry {
  page: FigExportPage
  canvasGuid: GUID
  canvasNc: KiwiNodeChange
}

export class FigCompressionCancellationUnsupportedError extends Error {
  readonly code = 'fig-compression-cancellation-unsupported'
  override readonly name = 'FigCompressionCancellationUnsupportedError'
}

function variableValueToKiwi(
  value: VariableValue,
  type: string,
  varIdToGuid: Map<string, GUID>
): { value: Record<string, unknown>; dataType: string; resolvedDataType: string } {
  if (value && typeof value === 'object' && 'aliasId' in value) {
    const aliasGuid = varIdToGuid.get(value.aliasId) ?? stringToGuid(value.aliasId)
    return {
      value: { alias: { guid: aliasGuid } },
      dataType: 'ALIAS',
      resolvedDataType: { COLOR: 'COLOR', BOOLEAN: 'BOOLEAN', STRING: 'STRING' }[type] ?? 'FLOAT'
    }
  }
  if (type === 'COLOR' && typeof value === 'object' && 'r' in value) {
    return {
      value: { colorValue: safeColor(value) },
      dataType: 'COLOR',
      resolvedDataType: 'COLOR'
    }
  }
  if (type === 'BOOLEAN') {
    return { value: { boolValue: !!value }, dataType: 'BOOLEAN', resolvedDataType: 'BOOLEAN' }
  }
  if (type === 'STRING') {
    return {
      value: { textValue: typeof value === 'string' ? value : JSON.stringify(value) },
      dataType: 'STRING',
      resolvedDataType: 'STRING'
    }
  }
  return { value: { floatValue: Number(value) }, dataType: 'FLOAT', resolvedDataType: 'FLOAT' }
}

function collectImageEntries(graph: SceneGraph): Array<{ name: string; data: Uint8Array }> {
  const entries: Array<{ name: string; data: Uint8Array }> = []
  for (const [hash, data] of graph.images) {
    entries.push({ name: `images/${hash}`, data })
  }
  return entries
}

const THUMBNAIL_WIDTH = 400
const THUMBNAIL_HEIGHT = 225

export async function renderFigThumbnail(
  graph: SceneGraph,
  pageId: string | undefined,
  ck?: CanvasKit,
  renderer?: SkiaRenderer,
  renderHeadless = false,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (!pageId) return THUMBNAIL_1X1
  if (canUseRasterExportWorker()) {
    return (
      (await renderFixedThumbnailViaWorker(
        graph,
        pageId,
        THUMBNAIL_WIDTH,
        THUMBNAIL_HEIGHT,
        signal
      )) ?? THUMBNAIL_1X1
    )
  }
  if (ck && renderer) {
    return (
      renderThumbnail(ck, renderer, graph, pageId, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT) ??
      THUMBNAIL_1X1
    )
  }
  if (!renderHeadless || IS_BROWSER || IS_TAURI) return THUMBNAIL_1X1
  throwIfIOCancelled(signal)
  const { headlessRenderThumbnail } = await import('#core/io/formats/raster')
  const thumbnail =
    (await headlessRenderThumbnail(graph, pageId, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)) ??
    THUMBNAIL_1X1
  throwIfIOCancelled(signal)
  return thumbnail
}

function assignVariableGuid(
  id: string,
  localIdCounter: { value: number },
  assignedGuidValues: Set<string>,
  nodeSourceGuidValues: Set<string>
): GUID {
  if (/^\d+:\d+$/.test(id) && !assignedGuidValues.has(id) && !nodeSourceGuidValues.has(id)) {
    const guid = stringToGuid(id)
    assignedGuidValues.add(id)
    return guid
  }
  const guid = { sessionID: 0, localID: localIdCounter.value++ }
  assignedGuidValues.add(`${guid.sessionID}:${guid.localID}`)
  return guid
}

function assignVariableGuids(
  graph: SceneGraph,
  localIdCounter: { value: number },
  varIdToGuid: Map<string, GUID>,
  modeIdToGuid: Map<string, GUID>,
  assignedGuidValues: Set<string>,
  nodeSourceGuidValues: Set<string>
): void {
  for (const [colId, col] of graph.variableCollections) {
    const colGuid = assignVariableGuid(
      colId,
      localIdCounter,
      assignedGuidValues,
      nodeSourceGuidValues
    )
    varIdToGuid.set(colId, colGuid)
    for (const mode of col.modes) {
      const modeGuid = assignVariableGuid(
        mode.modeId,
        localIdCounter,
        assignedGuidValues,
        nodeSourceGuidValues
      )
      modeIdToGuid.set(mode.modeId, modeGuid)
    }
    for (const varId of col.variableIds) {
      const varGuid = assignVariableGuid(
        varId,
        localIdCounter,
        assignedGuidValues,
        nodeSourceGuidValues
      )
      varIdToGuid.set(varId, varGuid)
    }
  }
}

function appendVariableNodeChanges(
  graph: SceneGraph,
  nodeChanges: KiwiNodeChange[],
  internalCanvasGuid: GUID,
  varIdToGuid: Map<string, GUID>,
  modeIdToGuid: Map<string, GUID>
): void {
  let collIdx = 0
  for (const [colId, col] of graph.variableCollections) {
    const colGuid = varIdToGuid.get(colId) ?? stringToGuid(colId)
    nodeChanges.push({
      guid: colGuid,
      parentIndex: { guid: internalCanvasGuid, position: fractionalPosition(collIdx++) },
      type: 'VARIABLE_SET',
      name: col.name,
      phase: 'CREATED',
      strokeAlign: 'CENTER',
      strokeJoin: 'BEVEL',
      variableSetModes: col.modes.map((m, i) => {
        const mGuid = modeIdToGuid.get(m.modeId) ?? stringToGuid(m.modeId)
        return { id: mGuid, name: m.name, sortPosition: fractionalPosition(i) }
      })
    })

    appendVariablesForCollection(
      graph,
      nodeChanges,
      colGuid,
      internalCanvasGuid,
      col.variableIds,
      varIdToGuid,
      modeIdToGuid
    )
  }
}

function appendVariablesForCollection(
  graph: SceneGraph,
  nodeChanges: KiwiNodeChange[],
  colGuid: GUID,
  parentGuid: GUID,
  variableIds: string[],
  varIdToGuid: Map<string, GUID>,
  modeIdToGuid: Map<string, GUID>
): void {
  let varIdx = 0
  for (const varId of variableIds) {
    const variable = graph.variables.get(varId)
    if (!variable) continue

    const varGuid = varIdToGuid.get(varId) ?? stringToGuid(varId)
    const typeMap: Record<string, string> = {
      COLOR: 'COLOR',
      BOOLEAN: 'BOOLEAN',
      STRING: 'STRING'
    }
    const resolvedType = typeMap[variable.type] ?? 'FLOAT'

    const entries = Object.entries(variable.valuesByMode).map(([modeId, value]) => ({
      modeID: modeIdToGuid.get(modeId) ?? stringToGuid(modeId),
      variableData: variableValueToKiwi(value, variable.type, varIdToGuid)
    }))

    const nc: KiwiNodeChange = {
      guid: varGuid,
      parentIndex: { guid: parentGuid, position: fractionalPosition(varIdx++) },
      type: 'VARIABLE',
      name: variable.name,
      phase: 'CREATED',
      strokeAlign: 'CENTER',
      strokeJoin: 'BEVEL',
      variableSetID: { guid: colGuid },
      variableResolvedType: resolvedType,
      variableDataValues: { entries },
      variableScopes: ['ALL_SCOPES']
    }
    // Preserve library key/version on VARIABLE NodeChanges so that
    // buildAssetRefMap can resolve assetRef to guid on reimport.
    if (variable.key) nc.key = variable.key
    if (variable.version) nc.version = variable.version
    nodeChanges.push(nc)
  }
}

function applyImportedCanvasFields(page: FigExportPage, canvasNc: KiwiNodeChange): void {
  if (!page.source.id) return
  if (!('pageType' in page.source.fig.rawNodeFields)) delete canvasNc.pageType
  if ('backgroundColor' in page.source.fig.rawNodeFields) {
    canvasNc.backgroundColor = structuredClone(page.source.fig.rawNodeFields.backgroundColor)
  }
  if ('backgroundPaints' in page.source.fig.rawNodeFields) {
    canvasNc.backgroundPaints = structuredClone(
      page.source.fig.rawNodeFields.backgroundPaints
    ) as NodeChange['backgroundPaints']
  }
  if ('guides' in page.source.fig.rawNodeFields) {
    canvasNc.guides = structuredClone(page.source.fig.rawNodeFields.guides)
  }
  const strokeJoin = page.source.fig.rawNodeFields.strokeJoin
  if (typeof strokeJoin === 'string') canvasNc.strokeJoin = strokeJoin
  const strokeWeight = page.source.fig.rawNodeFields.strokeWeight
  if (typeof strokeWeight === 'number') canvasNc.strokeWeight = strokeWeight
}

function buildCanvasEntries(
  graph: SceneGraph,
  pages: FigExportPage[],
  docGuid: GUID,
  localIdCounter: { value: number },
  nodeIdToGuid: Map<string, GUID>,
  assignedGuidValues: Set<string>
): { canvasEntries: CanvasExportEntry[]; internalCanvasGuid: GUID | null } {
  const canvasEntries: CanvasExportEntry[] = []
  let internalCanvasGuid: GUID | null = null
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p]
    const canvasGuid = (() => {
      if (!page.source.id) return { sessionID: 0, localID: localIdCounter.value++ }

      const importedGuid = stringToGuid(page.source.id)
      const key = `${importedGuid.sessionID}:${importedGuid.localID}`

      if (!assignedGuidValues.has(key)) return importedGuid

      return { sessionID: 0, localID: localIdCounter.value++ }
    })()
    // Advance counter past any source.id-derived GUID to prevent collisions
    // with subsequently generated variable/collection GUIDs.
    if (page.source.id && canvasGuid.sessionID === 0) {
      localIdCounter.value = Math.max(localIdCounter.value, canvasGuid.localID + 1)
    }
    nodeIdToGuid.set(page.id, canvasGuid)
    assignedGuidValues.add(`${canvasGuid.sessionID}:${canvasGuid.localID}`)
    if (page.internalOnly) internalCanvasGuid = canvasGuid

    const canvasNc = makeCanvasNodeChange(
      canvasGuid,
      docGuid,
      page.source.orderKey ?? fractionalPosition(p),
      page.name,
      {
        backgroundOpacity: 1,
        backgroundColor: { ...CANVAS_BG_COLOR },
        backgroundEnabled: true
      }
    )
    applyImportedCanvasFields(page, canvasNc)
    if (page.internalOnly) canvasNc.internalOnly = true
    canvasEntries.push({ page, canvasGuid, canvasNc })
  }

  const hasSharedStyles = [...graph.nodes.values()].some((node) => node.sharedStyleType !== null)
  if ((graph.variableCollections.size > 0 || hasSharedStyles) && internalCanvasGuid === null) {
    internalCanvasGuid = { sessionID: 0, localID: localIdCounter.value++ }
    assignedGuidValues.add(`${internalCanvasGuid.sessionID}:${internalCanvasGuid.localID}`)
    canvasEntries.push({
      page: { id: '', name: 'Internal Only Canvas', internalOnly: true } as FigExportPage,
      canvasGuid: internalCanvasGuid,
      canvasNc: makeCanvasNodeChange(
        internalCanvasGuid,
        docGuid,
        fractionalPosition(canvasEntries.length),
        'Internal Only Canvas',
        { internalOnly: true }
      )
    })
  }

  return { canvasEntries, internalCanvasGuid }
}

interface InternalResourceContext {
  graph: SceneGraph
  nodeChanges: KiwiNodeChange[]
  internalCanvasGuid: GUID | null
  localIdCounter: { value: number }
  blobs: Uint8Array[]
  nodeIdToGuid: Map<string, GUID>
  fontDigestMap: Map<string, Uint8Array>
  varIdToGuid: Map<string, GUID>
  modeIdToGuid: Map<string, GUID>
  glyphBlobMap: Map<string, number>
  blobIndexByHex: Map<string, number>
  assignedGuidValues: Set<string>
  componentPropertyDefinitionsById: ReturnType<typeof buildComponentPropIndex>
}

function appendInternalResources(context: InternalResourceContext): void {
  const { graph, internalCanvasGuid, nodeChanges } = context
  if (!internalCanvasGuid) return
  const sharedStyleNodes = [...graph.nodes.values()].filter((node) => node.sharedStyleType !== null)
  for (let index = 0; index < sharedStyleNodes.length; index++) {
    nodeChanges.push(
      ...sceneNodeToKiwi(
        sharedStyleNodes[index],
        internalCanvasGuid,
        index,
        context.localIdCounter,
        graph,
        context.blobs,
        context.nodeIdToGuid,
        context.fontDigestMap,
        context.varIdToGuid,
        context.glyphBlobMap,
        context.blobIndexByHex,
        context.assignedGuidValues,
        context.componentPropertyDefinitionsById,
        context.modeIdToGuid
      )
    )
  }
  if (graph.variableCollections.size > 0) {
    appendVariableNodeChanges(
      graph,
      nodeChanges,
      internalCanvasGuid,
      context.varIdToGuid,
      context.modeIdToGuid
    )
  }
}

async function compressViaTauri(
  schemaDeflated: Uint8Array,
  kiwiData: Uint8Array,
  thumbnailPNG: Uint8Array,
  metaJSON: string,
  imageEntries: Array<{ name: string; data: Uint8Array }>,
  figKiwiVersion: number | undefined,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (signal?.aborted) throw new IOCancelledError('IO export cancelled')
  const { invoke } = await import('@tauri-apps/api/core')
  if (signal?.aborted) throw new IOCancelledError('IO export cancelled')
  const compression = invoke<number[]>('build_fig_file', {
    schemaDeflated: Array.from(schemaDeflated),
    kiwiData: Array.from(kiwiData),
    thumbnailPng: Array.from(thumbnailPNG),
    metaJson: metaJSON,
    images: imageEntries.map((e) => ({ name: e.name, data: Array.from(e.data) })),
    figKiwiVersion
  })
  if (!signal) return new Uint8Array(await compression)

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', cancel)
      callback()
    }
    const cancel = () =>
      finish(() =>
        reject(
          new FigCompressionCancellationUnsupportedError(
            'Active FIG compression cannot be cancelled across the Tauri invoke boundary'
          )
        )
      )

    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) {
      cancel()
      return
    }
    void compression
      .then((bytes) => finish(() => resolve(new Uint8Array(bytes))))
      .catch((error: unknown) =>
        finish(() => reject(error instanceof Error ? error : new Error(String(error))))
      )
  })
}

export async function exportFigFile(
  sourceGraph: SceneGraph,
  ck?: CanvasKit,
  renderer?: SkiaRenderer,
  pageId?: string,
  renderHeadlessThumbnail = false,
  signal?: AbortSignal
): Promise<Uint8Array> {
  // Lazy population synchronizes component trees and therefore mutates its graph. Saving must not
  // rewrite the live editor document or restore component values over edits made by the user.
  const graph = deserializeSceneGraph(structuredClone(serializeSceneGraph(sourceGraph)))
  populateAllLazyFigImportRoots(graph)
  await initCodec()

  // When the document was imported from a .fig file, preserve the original
  // kiwi schema for both encoding and embedding. For the current version of
  // Figma, likely for quite some time, schema has more types/fields than our
  // subset, and using our schema to encode would produce field IDs that don't
  // align with the embedded schema. By compiling and using the original
  // schema, we improve the roundtrip-ability... This requires further work.
  let compiled: ReturnType<typeof getCompiledSchema>
  let schemaDeflated: Uint8Array
  if (graph.figSchemaDeflated) {
    const schemaBytes = inflateSync(graph.figSchemaDeflated)
    const figSchema = decodeBinarySchema(new ByteBuffer(schemaBytes))
    compiled = compileSchema(figSchema) as ReturnType<typeof getCompiledSchema>
    schemaDeflated = graph.figSchemaDeflated
  } else {
    compiled = getCompiledSchema()
    schemaDeflated = deflateSync(getSchemaBytes())
  }

  const docGuid = { sessionID: 0, localID: 0 }
  const localIdCounter = { value: 2 }

  const documentNc = makeDocumentNodeChange(docGuid, graph.documentColorSpace)
  const rootNode = graph.getNode(graph.rootId)
  if (rootNode) Object.assign(documentNc, rootNode.source.fig.rawNodeFields)
  const nodeChanges: KiwiNodeChange[] = [documentNc]

  const blobs: Uint8Array[] = []
  const pages = graph.getPages(true)
  const nodeIdToGuid = new Map<string, GUID>()
  const assignedGuidValues = new Set<string>()
  // Reserve the document GUID to prevent imported nodes with source.id "0:0"
  // from reusing the document's own GUID slot.
  assignedGuidValues.add(`${docGuid.sessionID}:${docGuid.localID}`)
  const varIdToGuid = new Map<string, GUID>()
  const modeIdToGuid = new Map<string, GUID>()
  const fontDigestMap = await buildFontDigestMap(graph)
  const glyphBlobMap = new Map<string, number>()
  const blobIndexByHex = new Map<string, number>()
  const componentPropertyDefinitionsById = buildComponentPropIndex(graph)

  // Scan ALL imported source.ids BEFORE any new GUID assignment to find
  // max sessionID:0 and sessionID:1 localID values. This guarantees the
  // counter is past every imported GUID before any canvas, variable, or
  // node claims a new counter-based GUID — preventing collisions.
  let maxLocalId0 = localIdCounter.value - 1
  let maxLocalId1 = localIdCounter.value - 1
  const nodeSourceGuidValues = new Set<string>()
  for (const node of graph.nodes.values()) {
    if (node.source.id) {
      nodeSourceGuidValues.add(node.source.id)
      const g = stringToGuid(node.source.id)
      if (g.sessionID === 0 && g.localID > maxLocalId0) {
        maxLocalId0 = g.localID
      }
      if (g.sessionID === 1 && g.localID > maxLocalId1) {
        maxLocalId1 = g.localID
      }
    }
  }
  localIdCounter.value = Math.max(localIdCounter.value, maxLocalId0 + 1, maxLocalId1 + 1)

  const { canvasEntries, internalCanvasGuid } = buildCanvasEntries(
    graph,
    pages,
    docGuid,
    localIdCounter,
    nodeIdToGuid,
    assignedGuidValues
  )

  // Assign variable GUIDs AFTER canvas entries so that source.id-derived
  // canvas GUIDs don't collide with generated variable GUIDs.
  assignVariableGuids(
    graph,
    localIdCounter,
    varIdToGuid,
    modeIdToGuid,
    assignedGuidValues,
    nodeSourceGuidValues
  )

  for (const entry of canvasEntries) nodeChanges.push(entry.canvasNc)

  const orderedCanvasEntries = [
    ...canvasEntries.filter((entry) => entry.page.internalOnly),
    ...canvasEntries.filter((entry) => !entry.page.internalOnly)
  ]
  for (const { page, canvasGuid } of orderedCanvasEntries) {
    const children = graph.getChildren(page.id).filter((child) => !child.internalOnly)
    for (let i = 0; i < children.length; i++) {
      nodeChanges.push(
        ...sceneNodeToKiwi(
          children[i],
          canvasGuid,
          i,
          localIdCounter,
          graph,
          blobs,
          nodeIdToGuid,
          fontDigestMap,
          varIdToGuid,
          glyphBlobMap,
          blobIndexByHex,
          assignedGuidValues,
          componentPropertyDefinitionsById,
          modeIdToGuid
        )
      )
    }
  }

  appendInternalResources({
    graph,
    nodeChanges,
    internalCanvasGuid,
    localIdCounter,
    blobs,
    nodeIdToGuid,
    fontDigestMap,
    varIdToGuid,
    modeIdToGuid,
    glyphBlobMap,
    blobIndexByHex,
    assignedGuidValues,
    componentPropertyDefinitionsById
  })

  const msg: Record<string, unknown> = {
    type: 'NODE_CHANGES',
    sessionID: 0,
    ackID: 0,
    nodeChanges
  }

  if (blobs.length > 0) {
    msg.blobs = blobs.map((bytes) => ({ bytes }))
  }

  const kiwiData = compiled.encodeMessage(msg)

  const currentPageId = pageId ?? pages[0]?.id
  const thumbnailPNG = await renderFigThumbnail(
    graph,
    currentPageId,
    ck,
    renderer,
    renderHeadlessThumbnail,
    signal
  )

  const metaJSON = JSON.stringify({
    version: 1,
    app: 'OpenPencil',
    createdAt: new Date().toISOString()
  })

  const imageEntries = collectImageEntries(graph)

  const version = graph.figKiwiVersion ?? undefined

  if (IS_TAURI) {
    return compressViaTauri(
      schemaDeflated,
      kiwiData,
      thumbnailPNG,
      metaJSON,
      imageEntries,
      version,
      signal
    )
  }

  return compressFigData(
    schemaDeflated,
    kiwiData,
    thumbnailPNG,
    metaJSON,
    imageEntries,
    version,
    signal
  )
}

export { compressFigDataSync } from '@open-pencil/fig'

const FIG_COMPRESSION_TIMEOUT_MS = 60_000

export class FigCompressionWorkerProtocolError extends Error {
  override name = 'FigCompressionWorkerProtocolError'
}

function canUseWorker(): boolean {
  return typeof Worker !== 'undefined' && IS_BROWSER
}

function compressViaWorker(
  schemaDeflated: Uint8Array,
  kiwiData: Uint8Array,
  thumbnailPNG: Uint8Array,
  metaJSON: string,
  imageEntries: Array<{ name: string; data: Uint8Array }>,
  figKiwiVersion?: number,
  signal?: AbortSignal,
  timeoutMs = FIG_COMPRESSION_TIMEOUT_MS
): Promise<Uint8Array> {
  if (signal?.aborted) {
    return Promise.reject(new IOCancelledError('IO export cancelled'))
  }

  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./export-worker.ts', import.meta.url), {
        type: 'module'
      })
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
      worker.terminate()
      callback()
    }
    const cancel = () => finish(() => reject(new IOCancelledError('IO export cancelled')))
    const timeout = setTimeout(cancel, timeoutMs)

    worker.onmessage = (e: MessageEvent<Uint8Array>) => {
      finish(() => {
        if (signal?.aborted) {
          reject(new IOCancelledError('IO export cancelled'))
        } else if (!(e.data instanceof Uint8Array)) {
          reject(
            new FigCompressionWorkerProtocolError('FIG compression worker returned invalid data')
          )
        } else {
          resolve(e.data)
        }
      })
    }
    worker.onerror = (err) => {
      finish(() => reject(new Error(err.message || 'FIG compression worker failed')))
    }

    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) {
      cancel()
      return
    }

    // Do NOT use transferables here. toUint8Array() in ByteBuffer returns a view of the
    // internal buffer, so transferring kiwiData.buffer or schemaDeflated.buffer detaches
    // buffers that may be shared with other views, causing "already detached" errors on
    // subsequent saves. Structured clone (the default) copies the data safely.
    try {
      worker.postMessage({
        schemaDeflated,
        kiwiData,
        thumbnailPNG,
        metaJSON,
        images: imageEntries,
        figKiwiVersion
      })
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))
    }
  })
}

export function compressFigData(
  schemaDeflated: Uint8Array,
  kiwiData: Uint8Array,
  thumbnailPNG: Uint8Array,
  metaJSON: string,
  imageEntries: Array<{ name: string; data: Uint8Array }>,
  figKiwiVersion?: number,
  signal?: AbortSignal,
  timeoutMs = FIG_COMPRESSION_TIMEOUT_MS
): Promise<Uint8Array> {
  if (signal?.aborted) {
    return Promise.reject(new IOCancelledError('IO export cancelled'))
  }
  if (canUseWorker()) {
    return compressViaWorker(
      schemaDeflated,
      kiwiData,
      thumbnailPNG,
      metaJSON,
      imageEntries,
      figKiwiVersion,
      signal,
      timeoutMs
    )
  }
  if (signal) {
    return Promise.reject(
      new FigCompressionCancellationUnsupportedError('Abortable FIG compression requires a worker')
    )
  }
  return Promise.resolve(
    compressFigDataSync(
      schemaDeflated,
      kiwiData,
      thumbnailPNG,
      metaJSON,
      imageEntries,
      figKiwiVersion
    )
  )
}
