import { SortableTree, type SortableTreeChangeDetails, type SortableTreeNode } from '@ch5me/ch5-ui-web';
import uiPackage from '@ch5me/ch5-ui-web/package.json';
import {
  createCompositionPlan
} from '@open-pencil/core/canvas/composition';
import {
  composeRasterRGBA8
} from '@open-pencil/core/canvas/image-editor';
import { SceneGraph } from '@open-pencil/scene-graph';
import {
  applySortableTreeChange,
  GEOMETRY_CONTROLS,
  getPointerTreeMove,
  sortableNodesFromLayers,
  visibleSortableTreeIds,
  updateGeometryControl,
  type GeometryControlKey,
} from './editor/producer-compatibility';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DocumentHistory,
  createEditorDocument,
  deleteLayer,
  documentCommand,
  findLayer,
  parseEditorDocument,
  updateLayer,
  updateLayerSelection,
  type BlendMode,
  type EditorDocument,
  type EditorLayer,
  type LayerBounds,
} from './model/editor-document';
import {
  collectHistoryAssetGarbage,
  duplicateLayerWithAssets,
} from './model/editor-asset-lifecycle';
import {
  EditorAssetRegistry,
  type SerializedEditorAssets,
} from './rendering/editor-asset-registry';
import {
  EditorWorkingDocument,
  getEditorPersistenceRecoveryState,
} from './model/editor-working-document';
import { composeRgba8 } from './model/composition-full';
import { resizeLayerBounds, type ResizeHandle } from './editor/resize-geometry';
import { keyboardResize, transformHandleLabel, transformState } from './editor/transform-accessibility';
import {
  DEFAULT_GEOMETRY_SNAP_SETTINGS,
  snapGeometryBounds,
  type GeometrySnapSettings,
  type SnapGuide,
} from './editor/geometry-guides';
import {
  maskCursorCenter,
  maskKeyboardState,
  moveMaskCursor,
  toggleMaskBrushMode,
  type MaskCursor,
  type MaskCursorKey,
} from './editor/mask-keyboard';
import { MaskStrokeHistory } from './editor/mask-stroke-history';
import { CompositorCanvas, type CompositorCanvasHandle } from './editor/compositor-canvas';
import {
  createConsumerCompositorRecoveryController,
  type ConsumerCompositorRecoveryController,
} from './editor/consumer-loading';
import type { CompositorFailure, CompositorLayer } from './rendering/compositor/three-compositor';

type RasterLayer = Exclude<EditorLayer, { kind: 'group' | 'adjustment' }>;
type Tool = 'move' | 'hand' | 'mask';
type Gesture = {
  kind: 'move' | 'resize' | 'rotate';
  handle?: ResizeHandle;
  lockAspectRatio: boolean;
  startX: number;
  startY: number;
  startAngle?: number;
  before: EditorDocument;
  bounds: LayerBounds;
  rotation: number;
};
type PanGesture = { startX: number; startY: number; panX: number; panY: number };
type EditorArchive = {
  schema: 'ch5.editor.archive.v1';
  document: EditorDocument;
  assets: SerializedEditorAssets;
};

const MIN_LAYER_SIZE = 24;
const showNestedGroupProof = new URLSearchParams(window.location.search).get('proof') === 'nested-group';
function openPencilCorePixel(foregroundValue: number): string {
  const graph = new SceneGraph();
  const page = graph.getPages()[0];
  if (!page) {
    throw new Error('Installed OpenPencil SceneGraph created no page');
  }
  const outer = graph.createNodeWithId('proof-outer', 'GROUP', page.id, {
    childIds: ['proof-background', 'proof-inner']
  });
  graph.createNodeWithId('proof-background', 'RECTANGLE', outer.id, {
    fills: [{
      type: 'IMAGE',
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: 'asset:background'
    }]
  });
  const inner = graph.createNodeWithId('proof-inner', 'GROUP', outer.id, {
    childIds: ['proof-foreground'],
    opacity: 0.5
  });
  graph.createNodeWithId('proof-foreground', 'RECTANGLE', inner.id, {
    fills: [{
      type: 'IMAGE',
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: 'asset:foreground'
    }]
  });
  const revisions = new Map<`sha256:${string}`, {
    revisionId: `sha256:${string}`;
    kind: string;
    metadata: Readonly<Record<string, unknown>>;
    bytes: Uint8Array;
  }>([
    ['sha256:background', {
      revisionId: 'sha256:background',
      kind: 'image',
      metadata: { format: 'rgba8-srgb', width: 1, height: 1 },
      bytes: Uint8Array.of(0, 0, 0, 255)
    }],
    ['sha256:foreground', {
      revisionId: 'sha256:foreground',
      kind: 'image',
      metadata: { format: 'rgba8-srgb', width: 1, height: 1 },
      bytes: Uint8Array.of(foregroundValue, foregroundValue, foregroundValue, 255)
    }]
  ]);
  const result = composeRasterRGBA8(
    createCompositionPlan(graph, outer.id),
    {
      getAsset: assetId => ({
        assetId,
        revisionId: assetId === 'asset:background' ? 'sha256:background' : 'sha256:foreground'
      }),
      getRevision: revisionId => revisions.get(revisionId as `sha256:${string}`)
    },
    { width: 1, height: 1, backend: 'canvas2d' }
  );
  return [...result.pixels].join(',');
}
const installedCorePixel = showNestedGroupProof ? openPencilCorePixel(188) : '';
const installedCoreSeededPixel = showNestedGroupProof ? openPencilCorePixel(189) : '';
const nestedGroupFrame = showNestedGroupProof ? composeRgba8({
  width: 1,
  height: 1,
  layers: [{
    id: 'outer',
    kind: 'group',
    opacity: 0.5,
    blendMode: 'screen',
    children: [{
      id: 'inner',
      kind: 'group',
      opacity: 0.75,
      children: [{
        id: 'blue',
        kind: 'raster',
        raster: { width: 1, height: 1, pixels: Uint8ClampedArray.of(0, 0, 255, 255) },
      }, {
        id: 'red',
        kind: 'raster',
        opacity: 0.5,
        raster: { width: 1, height: 1, pixels: Uint8ClampedArray.of(255, 0, 0, 255) },
      }],
    }],
  }],
}) : null;
if (nestedGroupFrame && new URLSearchParams(window.location.search).get('seed') === 'nested-group-red-plus-one') {
  nestedGroupFrame.pixels[0] += 1;
}
const nestedGroupPixel = nestedGroupFrame?.pixels.join(',') ?? '';

const handles: ReadonlyArray<{ handle: ResizeHandle; label: string }> = [
  { handle: 'nw', label: 'Resize top left' },
  { handle: 'n', label: 'Resize top' },
  { handle: 'ne', label: 'Resize top right' },
  { handle: 'e', label: 'Resize right' },
  { handle: 'se', label: 'Resize bottom right' },
  { handle: 's', label: 'Resize bottom' },
  { handle: 'sw', label: 'Resize bottom left' },
  { handle: 'w', label: 'Resize left' },
];

function contextFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable');
  return context;
}

function whiteSource(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = contextFor(canvas);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 1, 1);
  return canvas;
}

const adjustmentSource = whiteSource();

function isRasterLayer(layer: EditorLayer | undefined): layer is RasterLayer {
  return Boolean(layer && layer.kind !== 'group' && layer.kind !== 'adjustment');
}

function clippingBase(layer: RasterLayer, editor: EditorDocument): RasterLayer | undefined {
  const index = editor.layers.findIndex(candidate => candidate.id === layer.id);
  for (let cursor = index + 1; cursor < editor.layers.length; cursor += 1) {
    const candidate = editor.layers[cursor];
    if (!candidate || candidate.parentId !== layer.parentId) continue;
    if (candidate.kind === 'group' || candidate.kind === 'adjustment') return undefined;
    if (!candidate.clipped) return candidate;
  }
  return undefined;
}

function applyCanvasAdjustments(canvas: HTMLCanvasElement, adjustments: EditorLayer['adjustments'], opacity: number): void {
  if (opacity === 0 || Object.values(adjustments).every(value => value === 0)) return;
  const snapshot = document.createElement('canvas');
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  contextFor(snapshot).drawImage(canvas, 0, 0);
  const adjusted = document.createElement('canvas');
  adjusted.width = canvas.width;
  adjusted.height = canvas.height;
  const adjustedContext = contextFor(adjusted);
  adjustedContext.filter = `brightness(${Math.max(0, 1 + adjustments.brightness)}) contrast(${Math.max(0, 1 + adjustments.contrast)}) saturate(${Math.max(0, 1 + adjustments.saturation)}) blur(${adjustments.blur}px)`;
  adjustedContext.drawImage(snapshot, 0, 0);
  const context = contextFor(canvas);
  context.save();
  context.globalAlpha = opacity;
  context.globalCompositeOperation = 'source-over';
  context.drawImage(adjusted, 0, 0);
  context.restore();
}

function drawContent(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  bounds: LayerBounds,
  rotation: number,
  opacity: number,
  blendMode: BlendMode,
  mask?: HTMLCanvasElement,
): void {
  let rendered = source;
  if (mask) {
    const masked = document.createElement('canvas');
    masked.width = source.width;
    masked.height = source.height;
    const maskedContext = contextFor(masked);
    maskedContext.drawImage(source, 0, 0);
    maskedContext.globalCompositeOperation = 'destination-in';
    maskedContext.drawImage(mask, 0, 0, source.width, source.height);
    rendered = masked;
  }
  context.save();
  context.globalAlpha = opacity;
  context.globalCompositeOperation = blendMode === 'normal' ? 'source-over' : blendMode;
  context.translate(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  context.rotate(rotation * Math.PI / 180);
  context.drawImage(rendered, -bounds.width / 2, -bounds.height / 2, bounds.width, bounds.height);
  context.restore();
}

function groupSource(
  group: Extract<EditorLayer, { kind: 'group' }>,
  editor: EditorDocument,
  assets: EditorAssetRegistry,
  assetVersion: number,
): HTMLCanvasElement {
  const subtreeIds = new Set<string>([group.id]);
  for (const layer of editor.layers) {
    if (layer.parentId && subtreeIds.has(layer.parentId)) subtreeIds.add(layer.id);
  }
  const key = JSON.stringify([assetVersion, editor.layers.filter(layer => subtreeIds.has(layer.id))]);
  return assets.compositeFor(`group:${group.id}`, key, editor.width, editor.height, canvas => {
    const context = contextFor(canvas);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const children = editor.layers.filter(layer => layer.parentId === group.id).reverse();
    for (const child of children) {
      if (!child.visible || child.opacity === 0) continue;
      if (child.kind === 'adjustment') {
        applyCanvasAdjustments(canvas, child.adjustments, child.opacity);
      } else if (child.kind === 'group') {
        drawContent(context, groupSource(child, editor, assets, assetVersion), { x: 0, y: 0, width: editor.width, height: editor.height }, 0, child.opacity, child.blendMode);
      } else {
        drawContent(context, assets.sourceFor(child), child.bounds, child.rotation, child.opacity, child.blendMode, assets.combinedMaskFor(child, child.clipped ? clippingBase(child, editor) : undefined));
      }
    }
    applyCanvasAdjustments(canvas, group.adjustments, 1);
  });
}

function renderableLayers(editor: EditorDocument, assets: EditorAssetRegistry, assetVersion: number): Array<CompositorLayer> {
  const layers: CompositorLayer[] = [];
  for (const layer of editor.layers) {
    if (layer.parentId !== null) continue;
    if (layer.kind === 'group') {
      layers.push({
        id: layer.id,
        kind: 'content',
        source: groupSource(layer, editor, assets, assetVersion),
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        visible: layer.visible,
        bounds: { x: 0, y: 0, width: editor.width, height: editor.height },
      });
      continue;
    }
    if (layer.kind === 'adjustment') {
      layers.push({
        id: layer.id,
        kind: 'adjustment',
        source: adjustmentSource,
        opacity: layer.opacity,
        blendMode: 'normal',
        visible: layer.visible,
        bounds: { x: 0, y: 0, width: editor.width, height: editor.height },
        adjustments: layer.adjustments,
      });
      continue;
    }
    layers.push({
      id: layer.id,
      kind: 'content',
      source: assets.sourceFor(layer),
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      visible: layer.visible,
      bounds: { ...layer.bounds },
      rotation: layer.rotation,
      mask: assets.combinedMaskFor(layer, layer.clipped ? clippingBase(layer, editor) : undefined),
    });
  }
  return layers.reverse();
}

function drawCanvasFallback(canvas: HTMLCanvasElement, editor: EditorDocument, assets: EditorAssetRegistry, assetVersion: number): void {
  canvas.width = editor.width;
  canvas.height = editor.height;
  const context = contextFor(canvas);
  context.clearRect(0, 0, editor.width, editor.height);
  for (const layer of renderableLayers(editor, assets, assetVersion)) {
    if (!layer.visible || layer.opacity === 0) continue;
    if (layer.kind === 'adjustment') {
      const adjustments = layer.adjustments ?? { brightness: 0, contrast: 0, saturation: 0 };
      applyCanvasAdjustments(canvas, { ...adjustments, blur: 0 }, layer.opacity);
      continue;
    }
    const bounds = layer.bounds ?? { x: 0, y: 0, width: editor.width, height: editor.height };
    drawContent(context, layer.source, bounds, layer.rotation ?? 0, layer.opacity, layer.blendMode, layer.mask);
  }
}

function nextId(documentValue: EditorDocument, prefix: string): string {
  const ids = new Set(documentValue.layers.map(layer => layer.id));
  let suffix = documentValue.layers.length + 1;
  while (ids.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
}

function parseArchive(value: unknown): { document: EditorDocument; assets?: SerializedEditorAssets } {
  if (typeof value === 'object' && value !== null && 'schema' in value && value.schema === 'ch5.editor.archive.v1') {
    const archive = value as Partial<EditorArchive>;
    if (!archive.document || !archive.assets || typeof archive.assets !== 'object') {
      throw new Error('Invalid editor archive');
    }
    return { document: parseEditorDocument(archive.document), assets: archive.assets };
  }
  return { document: parseEditorDocument(value) };
}

function warningMessage(action: string, warnings: ReadonlyArray<{ message: string }>): string {
  return warnings.length === 0 ? `${action} with no compatibility warnings.` : `${action} with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings[0]?.message}`;
}

export function ThreeCompositorDemo() {
  const initial = useMemo(createEditorDocument, []);
  const historyRef = useRef(new DocumentHistory(initial));
  const documentRef = useRef(initial);
  const assetsRef = useRef(new EditorAssetRegistry());
  const workingDocumentRef = useRef(new EditorWorkingDocument());
  const compositorControllerRef = useRef<ConsumerCompositorRecoveryController | null>(null);
  const mountedRef = useRef(true);
  const canvasRef = useRef<CompositorCanvasHandle>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const moveToolRef = useRef<HTMLButtonElement>(null);
  const maskToolRef = useRef<HTMLButtonElement>(null);
  const maskReturnFocusRef = useRef<HTMLElement | null>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const psdFileRef = useRef<HTMLInputElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const propertyRef = useRef<{ label: string; before: EditorDocument } | null>(null);
  const panRef = useRef<PanGesture | null>(null);
  const maskStrokeRef = useRef<MaskStrokeHistory | null>(null);
  maskStrokeRef.current ??= new MaskStrokeHistory({
    snapshotMask: id => assetsRef.current.snapshotMask(id),
    restoreMask: snapshot => assetsRef.current.restoreMask(snapshot),
  });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const layerPointerRef = useRef<{ pointerId: number; sourceIndex: number; moved: boolean } | null>(null);
  const [documentValue, setDocumentValue] = useState(initial);
  const [assetVersion, setAssetVersion] = useState(0);
  const assetVersionRef = useRef(assetVersion);
  const [backend, setBackend] = useState<'compatibility' | 'initializing' | 'webgpu' | 'webgl2' | 'failed'>('compatibility');
  const [compositorGeneration, setCompositorGeneration] = useState(0);
  const [failure, setFailure] = useState<CompositorFailure | null>(null);
  const [message, setMessage] = useState('');
  const [tool, setTool] = useState<Tool>('move');
  const [maskErase, setMaskErase] = useState(true);
  const [maskCursor, setMaskCursor] = useState<MaskCursor | null>(null);
  const [maskAnnouncement, setMaskAnnouncement] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.72);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [snapSettings, setSnapSettings] = useState<GeometrySnapSettings>(DEFAULT_GEOMETRY_SNAP_SETTINGS);
  const [snapGuides, setSnapGuides] = useState<ReadonlyArray<SnapGuide>>([]);
  const [showRulers, setShowRulers] = useState(false);
  const [persistenceRecoveryAttempt, setPersistenceRecoveryAttempt] = useState(0);
  const [persistenceRecovery, setPersistenceRecovery] = useState(
    getEditorPersistenceRecoveryState('recovering')
  );
  const {
    ready: persistenceReady,
    writable: persistenceWritable,
    status: persistenceStatus,
  } = persistenceRecovery;
  const setPersistenceStatus = useCallback((status: typeof persistenceStatus) => {
    setPersistenceRecovery(current => ({ ...current, status }));
  }, []);
  documentRef.current = documentValue;
  assetVersionRef.current = assetVersion;

  const selected = documentValue.selectedLayerId ? findLayer(documentValue, documentValue.selectedLayerId) : undefined;
  const selectedRaster = isRasterLayer(selected) ? selected : undefined;
  const layerOrder = useMemo(() => documentValue.layers.map(layer => layer.id).join(' > '), [documentValue]);
  const treeNodes = useMemo<SortableTreeNode[]>(
    () => sortableNodesFromLayers(documentValue.layers),
    [documentValue]
  );
  const expandedIds = useMemo(() => new Set(documentValue.layers.filter(layer => layer.kind === 'group' && !layer.collapsed).map(layer => layer.id)), [documentValue]);

  const finalizeMaskStroke = useCallback(() => {
    const committed = maskStrokeRef.current?.finalize(historyRef.current) ?? false;
    if (committed) {
      setAssetVersion(value => value + 1);
    }
    return committed;
  }, []);

  const cancelMaskStroke = useCallback((pointerId?: number) => {
    const cancelled = maskStrokeRef.current?.cancel(pointerId) ?? false;
    if (cancelled) {
      setAssetVersion(value => value + 1);
    }
    return cancelled;
  }, []);

  const collectAssets = useCallback(() => {
    finalizeMaskStroke();
    if (collectHistoryAssetGarbage(historyRef.current, assetsRef.current).length > 0) {
      setAssetVersion(value => value + 1);
    }
  }, [finalizeMaskStroke]);

  const executeHistory = useCallback((label: string, before: EditorDocument, after: EditorDocument) => {
    finalizeMaskStroke();
    historyRef.current.execute(documentCommand(label, before, after));
    collectAssets();
  }, [collectAssets, finalizeMaskStroke]);

  const finishProperty = useCallback((current: EditorDocument) => {
    const pending = propertyRef.current;
    propertyRef.current = null;
    if (!pending || pending.before === current) return;
    executeHistory(pending.label, pending.before, current);
  }, [executeHistory]);

  const commit = (label: string, after: EditorDocument) => {
    finishProperty(documentValue);
    const before = historyRef.current.document;
    executeHistory(label, before, after);
    setDocumentValue(after);
  };

  const undo = useCallback(() => {
    finishProperty(documentRef.current);
    finalizeMaskStroke();
    historyRef.current.undo();
    collectAssets();
    setDocumentValue(historyRef.current.document);
    setAssetVersion(value => value + 1);
    setMaskAnnouncement('Undo complete.');
  }, [collectAssets, finalizeMaskStroke, finishProperty]);

  const redo = useCallback(() => {
    finishProperty(documentRef.current);
    cancelMaskStroke();
    historyRef.current.redo();
    collectAssets();
    setDocumentValue(historyRef.current.document);
    setAssetVersion(value => value + 1);
    setMaskAnnouncement('Redo complete.');
  }, [cancelMaskStroke, collectAssets, finishProperty]);

  const fit = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const next = Math.min((workspace.clientWidth - 72) / documentValue.width, (workspace.clientHeight - 72) / documentValue.height, 1);
    setZoom(Math.max(0.1, next));
    setPan({ x: 0, y: 0 });
  }, [documentValue.height, documentValue.width]);

  const ensureCompositor = () => {
    if (compositorControllerRef.current) return compositorControllerRef.current.ensure();
    const canvas = canvasRef.current?.canvas;
    if (!canvas) return Promise.reject(new Error('Compositor canvas unavailable'));
    const forceWebGL = new URLSearchParams(window.location.search).get('backend') === 'webgl';
    setBackend('initializing');
    const controller = createConsumerCompositorRecoveryController({
      options: {
        forceWebGL,
        pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
      },
      canvas: {
        get current() {
          return canvasRef.current?.canvas ?? canvas;
        },
        replace: () => {
          if (!canvasRef.current) throw new Error('Compositor canvas unavailable during recovery');
          return canvasRef.current.replace();
        },
      },
      requestedBackend: forceWebGL ? 'webgl2' : undefined,
      snapshot: () => ({
        layers: renderableLayers(documentRef.current, assetsRef.current, assetVersionRef.current),
        width: documentRef.current.width,
        height: documentRef.current.height,
      }),
      onFailure: next => {
        if (!mountedRef.current) return;
        setFailure(next);
        setBackend(next.kind === 'renderer-error' ? 'failed' : 'initializing');
      },
      onPublish: (compositor, generation) => {
        if (!mountedRef.current) return;
        setFailure(null);
        setBackend(compositor.backend);
        setCompositorGeneration(generation);
        requestAnimationFrame(fit);
      },
    });
    compositorControllerRef.current = controller;
    return controller.ensure().catch((cause: unknown) => {
      if (mountedRef.current) {
        setFailure({ kind: 'renderer-error', message: cause instanceof Error ? cause.message : 'Compositor initialization failed', cause });
        setBackend('failed');
      }
      throw cause;
    });
  };

  useEffect(() => () => {
    mountedRef.current = false;
    compositorControllerRef.current?.destroy();
    compositorControllerRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    setPersistenceRecovery(getEditorPersistenceRecoveryState('recovering'));
    void workingDocumentRef.current.recover()
      .then(async recovered => {
        if (cancelled) return;
        if (!recovered) {
          setMessage('');
          return;
        }
        await assetsRef.current.restore(recovered.assets);
        if (cancelled) return;
        historyRef.current.reset(recovered.document);
        setDocumentValue(recovered.document);
        setAssetVersion(value => value + 1);
        setPan({ x: recovered.viewport.panX, y: recovered.viewport.panY });
        setZoom(recovered.viewport.zoom);
        setMessage('Recovered autosaved working document');
      })
      .then(() => {
        if (!cancelled) {
          setPersistenceRecovery(getEditorPersistenceRecoveryState('saved'));
        }
      })
      .catch(error => {
        if (!cancelled) {
          const errorMessage = error instanceof Error ? error.message : 'E_PERSISTENCE_MIGRATION: recovery failed';
          if (persistenceRecoveryAttempt === 0) {
            setPersistenceRecovery(getEditorPersistenceRecoveryState('retrying'));
            setMessage(`${errorMessage}; retrying persistence recovery`);
            retryTimer = window.setTimeout(() => setPersistenceRecoveryAttempt(1), 1000);
          } else {
            setPersistenceRecovery(getEditorPersistenceRecoveryState('failed'));
            setMessage(errorMessage);
          }
        }
      });
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [persistenceRecoveryAttempt]);

  const persistWorkingDocument = useCallback(async () => {
    await workingDocumentRef.current.save({
      document: documentRef.current,
      assets: assetsRef.current.serialize(),
      viewport: { panX: pan.x, panY: pan.y, zoom }
    });
  }, [pan.x, pan.y, zoom]);

  useEffect(() => {
    if (!persistenceReady || !persistenceWritable) return;
    const timeout = window.setTimeout(() => {
      void persistWorkingDocument()
        .then(() => setPersistenceStatus('saved'))
        .catch(error => {
          setPersistenceStatus('failed');
          setMessage(error instanceof Error ? error.message : 'E_PERSISTENCE_MIGRATION: autosave failed');
        });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [assetVersion, documentValue, persistWorkingDocument, persistenceReady, persistenceWritable]);

  useEffect(() => {
    if (!persistenceReady || !persistenceWritable) return;
    const persistBeforeSuspend = () => {
      void persistWorkingDocument().catch(error => {
        setPersistenceStatus('failed');
        setMessage(error instanceof Error ? error.message : 'E_PERSISTENCE_MIGRATION: autosave failed');
      });
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') persistBeforeSuspend();
    };
    document.addEventListener('visibilitychange', persistWhenHidden);
    window.addEventListener('pagehide', persistBeforeSuspend);
    return () => {
      document.removeEventListener('visibilitychange', persistWhenHidden);
      window.removeEventListener('pagehide', persistBeforeSuspend);
    };
  }, [persistWorkingDocument, persistenceReady, persistenceWritable]);

  useEffect(() => {
    const controller = compositorControllerRef.current;
    if (!controller?.current && fallbackCanvasRef.current) {
      drawCanvasFallback(fallbackCanvasRef.current, documentValue, assetsRef.current, assetVersion);
    }
    const compositor = controller?.current;
    if (compositor) {
      try {
        compositor.resize(documentValue.width, documentValue.height);
        compositor.setLayers(renderableLayers(documentValue, assetsRef.current, assetVersion));
        compositor.render();
      } catch (cause) {
        const failure = { kind: 'renderer-error', message: cause instanceof Error ? cause.message : 'Compositor render failed', cause } satisfies CompositorFailure;
        void controller.recover(failure).catch(recoveryCause => {
          if (!mountedRef.current) return;
          setFailure({
            kind: 'renderer-error',
            message: recoveryCause instanceof Error ? recoveryCause.message : 'Compositor recovery failed',
            cause: recoveryCause
          });
          setBackend('failed');
        });
      }
    }
  }, [assetVersion, documentValue]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  const selectLayer = (id: string) => {
    finishProperty(documentValue);
    finalizeMaskStroke();
    updateLayerSelection(historyRef.current, id);
    collectAssets();
    const selectedDocument = historyRef.current.document;
    documentRef.current = selectedDocument;
    setDocumentValue(selectedDocument);
  };

  const patchSelected = (label: string, patch: Partial<EditorLayer>) => {
    if (!selected) return;
    commit(label, updateLayer(documentValue, selected.id, patch));
  };

  const previewSelected = (label: string, patch: Partial<EditorLayer>) => {
    if (!selected) return;
    propertyRef.current ??= { label, before: historyRef.current.document };
    setDocumentValue(updateLayer(documentValue, selected.id, patch));
  };

  const updateSelectedGeometry = (key: GeometryControlKey, raw: string) => {
    if (!selectedRaster) return;
    try {
      const geometry = updateGeometryControl(selectedRaster, key, raw);
      previewSelected(`Change ${key}`, geometry);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Invalid ${key} geometry value`);
    }
  };

  const insertLayer = (layer: EditorLayer) => {
    const parentIndex = layer.parentId ? documentValue.layers.findIndex(candidate => candidate.id === layer.parentId) : -1;
    const layers = documentValue.layers.slice();
    layers.splice(parentIndex >= 0 ? parentIndex + 1 : 0, 0, layer);
    commit(`Add ${layer.kind}`, { ...documentValue, layers, selectedLayerId: layer.id });
  };

  const addLayer = (kind: 'image' | 'text' | 'shape' | 'group' | 'adjustment') => {
    const id = nextId(documentValue, kind);
    const parentId = selected?.kind === 'group' ? selected.id : null;
    const common = {
      id,
      name: kind === 'group' ? 'New group' : kind === 'adjustment' ? 'Color adjustment' : kind === 'image' ? 'Generated image' : kind === 'text' ? 'New text' : 'New shape',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      parentId,
      maskEnabled: false,
      maskAssetId: null,
      clipped: false,
      adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 },
    };
    if (kind === 'group') return insertLayer({ ...common, kind, collapsed: false });
    if (kind === 'adjustment') return insertLayer({ ...common, kind });
    const renderable = { ...common, bounds: { x: 250, y: 210, width: 360, height: kind === 'text' ? 90 : 240 }, rotation: 0 };
    const layer: EditorLayer = kind === 'image'
      ? {
          ...renderable,
          kind,
          seed: id,
          assetId: null,
          sourceWidth: renderable.bounds.width,
          sourceHeight: renderable.bounds.height,
          sourceResolution: 72,
          crop: null
        }
      : kind === 'text'
        ? {
            ...renderable,
            kind,
            content: 'NEW LAYER',
            fontFamily: 'sans-serif',
            color: '#f7e6bd',
            fontSize: 56,
            fontWeight: 700,
            alignment: 'left',
            letterSpacing: 0,
            lineHeight: 1.2,
            wrapping: 'word'
          }
        : { ...renderable, kind, form: 'ellipse', fill: '#d09042', stroke: '#6d3925', cornerRadius: 0, path: [] };
    insertLayer(layer);
  };

  const addImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const asset = await assetsRef.current.importImage(file);
      const scale = Math.min(1, documentValue.width * 0.7 / asset.width, documentValue.height * 0.7 / asset.height);
      const width = Math.max(24, Math.round(asset.width * scale));
      const height = Math.max(24, Math.round(asset.height * scale));
      const id = nextId(documentValue, 'image');
      insertLayer({
        id,
        name: file.name.replace(/\.[^.]+$/, '') || 'Imported image',
        kind: 'image',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        parentId: selected?.kind === 'group' ? selected.id : null,
        maskEnabled: false,
        maskAssetId: null,
        clipped: false,
        adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 },
        bounds: { x: Math.round((documentValue.width - width) / 2), y: Math.round((documentValue.height - height) / 2), width, height },
        rotation: 0,
        seed: id,
        assetId: asset.id,
        sourceWidth: asset.width,
        sourceHeight: asset.height,
        sourceResolution: 72,
        crop: null,
      });
      setAssetVersion(value => value + 1);
      setMessage(`Imported ${file.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Image import failed');
    } finally {
      if (imageFileRef.current) imageFileRef.current.value = '';
    }
  };

  const duplicateSelected = () => {
    if (!selected) return;
    try {
      const result = duplicateLayerWithAssets(documentValue, selected.id, assetsRef.current);
      commit('Duplicate layer', result.document);
      setAssetVersion(value => value + 1);
    } catch (error) {
      collectAssets();
      setMessage(error instanceof Error ? error.message : 'Could not duplicate layer');
    }
  };

  const deleteSelected = () => {
    if (!selected) return;
    commit('Delete layer', deleteLayer(documentValue, selected.id));
    setAssetVersion(value => value + 1);
  };

  const toggleMask = () => {
    if (!selectedRaster) return;
    const maskAssetId = selectedRaster.maskAssetId ?? assetsRef.current.createMask(selectedRaster);
    patchSelected('Toggle mask', { maskAssetId, maskEnabled: !selectedRaster.maskEnabled });
    setAssetVersion(value => value + 1);
  };

  const startTransform = (event: React.PointerEvent, handle?: ResizeHandle, rotate = false) => {
    if (!selectedRaster || selectedRaster.locked || tool === 'mask' || tool === 'hand') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const stage = canvasRef.current?.canvas.getBoundingClientRect();
    const centerX = stage ? stage.left + (selectedRaster.bounds.x + selectedRaster.bounds.width / 2) * zoom : event.clientX;
    const centerY = stage ? stage.top + (selectedRaster.bounds.y + selectedRaster.bounds.height / 2) * zoom : event.clientY;
    gestureRef.current = {
      kind: rotate ? 'rotate' : handle ? 'resize' : 'move',
      handle,
      lockAspectRatio: event.shiftKey,
      startX: event.clientX,
      startY: event.clientY,
      startAngle: rotate ? Math.atan2(event.clientY - centerY, event.clientX - centerX) : undefined,
      before: documentValue,
      bounds: { ...selectedRaster.bounds },
      rotation: selectedRaster.rotation,
    };
  };

  const updateTransform = (event: React.PointerEvent) => {
    const gesture = gestureRef.current;
    if (!gesture || !selectedRaster) return;
    if (gesture.kind === 'rotate') {
      const stage = canvasRef.current?.canvas.getBoundingClientRect();
      if (!stage || gesture.startAngle === undefined) return;
      const centerX = stage.left + (gesture.bounds.x + gesture.bounds.width / 2) * zoom;
      const centerY = stage.top + (gesture.bounds.y + gesture.bounds.height / 2) * zoom;
      const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
      const rotation = Math.round(gesture.rotation + (angle - gesture.startAngle) * 180 / Math.PI);
      setDocumentValue(updateLayer(documentValue, selectedRaster.id, { rotation }));
      return;
    }
    const dx = (event.clientX - gesture.startX) / zoom;
    const dy = (event.clientY - gesture.startY) / zoom;
    let bounds = { ...gesture.bounds };
    if (gesture.kind === 'move') {
      bounds = { ...bounds, x: Math.round(bounds.x + dx), y: Math.round(bounds.y + dy) };
      const targets = documentValue.layers
        .filter((layer): layer is RasterLayer => isRasterLayer(layer) && layer.id !== selectedRaster.id && layer.visible)
        .map(layer => layer.bounds);
      const snapped = snapGeometryBounds(bounds, targets, documentValue, snapSettings, snapGuides);
      bounds = snapped.bounds;
      setSnapGuides(snapped.guides);
    } else {
      if (gesture.handle) bounds = resizeLayerBounds(gesture.bounds, gesture.handle, dx, dy, gesture.lockAspectRatio);
      setSnapGuides([]);
    }
    setDocumentValue(updateLayer(documentValue, selectedRaster.id, { bounds }));
  };

  const finishTransform = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setSnapGuides([]);
    if (!gesture || gesture.before === documentValue) return;
    executeHistory(`${gesture.kind[0]?.toUpperCase()}${gesture.kind.slice(1)} layer`, gesture.before, documentValue);
    setDocumentValue(documentValue);
  };

  const paintMaskAt = (
    clientX: number,
    clientY: number,
    layer: RasterLayer,
    assetId: string
  ): boolean => {
    const stage = canvasRef.current?.canvas.getBoundingClientRect();
    if (!stage) return false;
    const documentX = (clientX - stage.left) / zoom;
    const documentY = (clientY - stage.top) / zoom;
    const centerX = layer.bounds.x + layer.bounds.width / 2;
    const centerY = layer.bounds.y + layer.bounds.height / 2;
    const radians = -layer.rotation * Math.PI / 180;
    const dx = documentX - centerX;
    const dy = documentY - centerY;
    const x = dx * Math.cos(radians) - dy * Math.sin(radians) + layer.bounds.width / 2;
    const y = dx * Math.sin(radians) + dy * Math.cos(radians) + layer.bounds.height / 2;
    if (x < 0 || y < 0 || x > layer.bounds.width || y > layer.bounds.height) return false;
    assetsRef.current.paintMask(assetId, x, y, 28 / zoom, maskErase);
    setAssetVersion(value => value + 1);
    return true;
  };

  const paintMaskAtLocal = (cursor: MaskCursor) => {
    if (!selectedRaster?.maskEnabled || !selectedRaster.maskAssetId) return;
    finishProperty(documentRef.current);
    cancelMaskStroke();
    const start = maskStrokeRef.current?.start(
      -1,
      historyRef.current.document,
      selectedRaster.id,
      selectedRaster.maskAssetId
    );
    if (start !== 'started' && start !== 'coalesced') return;
    assetsRef.current.paintMask(selectedRaster.maskAssetId, cursor.x, cursor.y, 28 / zoom, maskErase);
    maskStrokeRef.current?.markPainted(-1, true);
    maskStrokeRef.current?.finish(-1, historyRef.current);
    setAssetVersion(value => value + 1);
    setMaskAnnouncement(maskKeyboardState(
      selectedRaster.name,
      cursor,
      maskErase ? 'erase' : 'reveal',
      maskErase ? 'Mask erased.' : 'Mask revealed.'
    ));
  };

  const enterMaskTool = () => {
    if (!selectedRaster?.maskEnabled) return;
    if (document.activeElement instanceof HTMLElement) {
      maskReturnFocusRef.current = document.activeElement;
    }
    const cursor = maskCursorCenter(selectedRaster.bounds);
    setTool('mask');
    setMaskCursor(cursor);
    setMaskAnnouncement(maskKeyboardState(
      selectedRaster.name,
      cursor,
      maskErase ? 'erase' : 'reveal',
      'Mask brush ready.'
    ));
    requestAnimationFrame(() => workspaceRef.current?.focus());
  };

  const exitMaskTool = () => {
    cancelMaskStroke();
    setTool('move');
    setMaskCursor(null);
    const returnFocus = maskReturnFocusRef.current;
    maskReturnFocusRef.current = null;
    if (returnFocus?.isConnected && !returnFocus.hasAttribute('disabled')) {
      returnFocus.focus();
    } else if (maskToolRef.current && !maskToolRef.current.disabled) {
      maskToolRef.current.focus();
    } else {
      moveToolRef.current?.focus();
    }
  };

  useEffect(() => {
    if (tool !== 'mask' || selectedRaster?.maskEnabled) return;
    cancelMaskStroke();
    setTool('move');
    setMaskCursor(null);
    maskReturnFocusRef.current = null;
    requestAnimationFrame(() => moveToolRef.current?.focus());
  }, [cancelMaskStroke, selectedRaster?.maskEnabled, tool]);

  const workspacePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'mask' && selectedRaster?.maskEnabled && selectedRaster.maskAssetId) {
      finishProperty(documentRef.current);
      const strokeDocument = historyRef.current.document;
      const strokeLayer = findLayer(strokeDocument, selectedRaster.id);
      if (!strokeLayer || !isRasterLayer(strokeLayer) || !strokeLayer.maskEnabled || !strokeLayer.maskAssetId) {
        return;
      }
      const start = maskStrokeRef.current?.start(
        event.pointerId,
        strokeDocument,
        strokeLayer.id,
        strokeLayer.maskAssetId
      );
      if (start === 'cancelled') {
        setAssetVersion(value => value + 1);
        if (pointersRef.current.size === 2) {
          const [a, b] = [...pointersRef.current.values()];
          pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
        }
        return;
      }
      if (start !== 'started' && start !== 'coalesced') return;
      maskStrokeRef.current?.markPainted(
        event.pointerId,
        paintMaskAt(event.clientX, event.clientY, strokeLayer, strokeLayer.maskAssetId)
      );
      return;
    }
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      return;
    }
    if (tool === 'hand' || event.target === event.currentTarget) {
      panRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
    }
  };

  const workspacePointerDownWithCompositor = (event: React.PointerEvent<HTMLDivElement>) => {
    void ensureCompositor().catch(() => undefined);
    workspacePointerDown(event);
  };

  const workspacePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const binding = maskStrokeRef.current?.binding(event.pointerId);
    if (binding && isRasterLayer(binding.layer)) {
      maskStrokeRef.current?.markPainted(
        event.pointerId,
        paintMaskAt(event.clientX, event.clientY, binding.layer, binding.assetId)
      );
      return;
    }
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      setZoom(Math.max(0.1, Math.min(4, pinchRef.current.zoom * distance / pinchRef.current.distance)));
      return;
    }
    const gesture = panRef.current;
    if (gesture) setPan({ x: gesture.panX + event.clientX - gesture.startX, y: gesture.panY + event.clientY - gesture.startY });
  };

  const workspacePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (maskStrokeRef.current?.finish(event.pointerId, historyRef.current)) {
      collectAssets();
      setAssetVersion(value => value + 1);
    }
    panRef.current = null;
  };

  const workspacePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    cancelMaskStroke(event.pointerId);
    panRef.current = null;
  };

  const canvasKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (tool === 'mask' && event.key === 'Escape') {
      event.preventDefault();
      exitMaskTool();
      return;
    }
    if (!selectedRaster || selectedRaster.locked) return;
    if (tool === 'mask' && selectedRaster.maskEnabled && selectedRaster.maskAssetId) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const cursor = maskCursor ?? maskCursorCenter(selectedRaster.bounds);
        const next = moveMaskCursor(cursor, event.key as MaskCursorKey, event.shiftKey ? 10 : 4, selectedRaster.bounds);
        setMaskCursor(next);
        setMaskAnnouncement(maskKeyboardState(selectedRaster.name, next, maskErase ? 'erase' : 'reveal'));
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        paintMaskAtLocal(maskCursor ?? maskCursorCenter(selectedRaster.bounds));
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        const next = toggleMaskBrushMode(maskErase ? 'erase' : 'reveal');
        setMaskErase(next === 'erase');
        setMaskAnnouncement(maskKeyboardState(
          selectedRaster.name,
          maskCursor ?? maskCursorCenter(selectedRaster.bounds),
          next,
          `${next === 'erase' ? 'Erase' : 'Reveal'} mode selected.`
        ));
        return;
      }
    }
    const amount = event.shiftKey ? 10 : 1;
    const arrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key);
    if (arrow) {
      event.preventDefault();
      if (event.altKey) {
        const width = Math.max(MIN_LAYER_SIZE, selectedRaster.bounds.width + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0));
        const height = Math.max(MIN_LAYER_SIZE, selectedRaster.bounds.height + (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0));
        patchSelected('Resize layer with keyboard', { bounds: { ...selectedRaster.bounds, width, height } });
      } else {
        patchSelected('Move layer with keyboard', {
          bounds: {
            ...selectedRaster.bounds,
            x: selectedRaster.bounds.x + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0),
            y: selectedRaster.bounds.y + (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0),
          },
        });
      }
    }
    if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      patchSelected('Rotate layer with keyboard', { rotation: selectedRaster.rotation + (event.key === ']' ? amount : -amount) });
    }
  };

  const transformHandleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    handle?: ResizeHandle,
    rotate = false,
  ) => {
    if (!selectedRaster || selectedRaster.locked || tool === 'mask') return;
    const amount = event.shiftKey ? 10 : 1;
    if (rotate) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      patchSelected('Rotate layer with keyboard', {
        rotation: selectedRaster.rotation + (event.key === 'ArrowRight' ? amount : -amount),
      });
      return;
    }
    if (!handle) return;
    const nextBounds = keyboardResize(selectedRaster.bounds, handle, event.key, amount);
    if (!nextBounds) return;
    event.preventDefault();
    patchSelected('Resize layer with keyboard', { bounds: nextBounds });
  };

  const saveJson = () => {
    const archive: EditorArchive = { schema: 'ch5.editor.archive.v1', document: documentValue, assets: assetsRef.current.serialize() };
    download('night-market.editor.json', new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }));
  };

  const loadJson = async (file: File | undefined) => {
    if (!file) return;
    cancelMaskStroke();
    try {
      const archive = parseArchive(JSON.parse(await file.text()) as unknown);
      await assetsRef.current.restore(archive.assets ?? {});
      historyRef.current.reset(archive.document);
      collectAssets();
      setDocumentValue(archive.document);
      setAssetVersion(value => value + 1);
      setMessage(`Loaded ${file.name}`);
      requestAnimationFrame(fit);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Invalid editor document');
    } finally {
      if (jsonFileRef.current) jsonFileRef.current.value = '';
    }
  };

  const loadPsd = async (file: File | undefined) => {
    if (!file) return;
    cancelMaskStroke();
    try {
      const { importPsd } = await import('./adapters/editor-psd');
      const result = await importPsd(await file.arrayBuffer(), assetsRef.current);
      historyRef.current.reset(result.document);
      collectAssets();
      setDocumentValue(result.document);
      setAssetVersion(value => value + 1);
      setMessage(warningMessage(`Imported ${file.name}`, result.warnings));
      requestAnimationFrame(fit);
    } catch (error) {
      setMessage(error instanceof Error ? `PSD import failed: ${error.message}` : 'PSD import failed');
    } finally {
      if (psdFileRef.current) psdFileRef.current.value = '';
    }
  };

  const savePsd = async () => {
    try {
      const composite = failure ? fallbackCanvasRef.current : canvasRef.current?.canvas;
      if (!composite) throw new Error('Rendered composite is unavailable');
      const { exportPsd } = await import('./adapters/editor-psd');
      const result = await exportPsd(documentValue, assetsRef.current, composite);
      download('night-market.psd', new Blob([result.buffer], { type: 'image/vnd.adobe.photoshop' }));
      setMessage(warningMessage('Exported PSD', result.warnings));
    } catch (error) {
      setMessage(error instanceof Error ? `PSD export failed: ${error.message}` : 'PSD export failed');
    }
  };

  const selectionStyle = selectedRaster ? {
    left: selectedRaster.bounds.x,
    top: selectedRaster.bounds.y,
    width: selectedRaster.bounds.width,
    height: selectedRaster.bounds.height,
    transform: `rotate(${selectedRaster.rotation}deg)`,
    pointerEvents: selectedRaster.locked ? 'none' as const : 'auto' as const,
  } : undefined;

  const onTreeMove = (_nodes: SortableTreeNode[], details: SortableTreeChangeDetails) => {
    try {
      commit('Move layer', applySortableTreeChange(documentValue, details));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Layer move failed');
    }
  };

  const layerTreePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const row = (event.target as Element).closest<HTMLElement>('[role="treeitem"]');
    if (!row || (event.target as Element).closest('button, a, input, select, textarea, [contenteditable="true"]')) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const sourceIndex = rows.indexOf(row);
    const sourceId = visibleSortableTreeIds(treeNodes, expandedIds)[sourceIndex];
    const source = sourceId ? findLayer(documentValue, sourceId) : undefined;
    if (source?.locked || !sourceId || sourceIndex < 0) return;
    layerPointerRef.current = { pointerId: event.pointerId, sourceIndex, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const layerTreePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = layerPointerRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[role="treeitem"]');
    if (!target || !event.currentTarget.contains(target)) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const targetIndex = rows.indexOf(target);
    if (targetIndex < 0 || targetIndex === gesture.sourceIndex) return;
    gesture.moved = true;
    event.preventDefault();
  };

  const layerTreePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = layerPointerRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[role="treeitem"]');
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const targetIndex = target ? rows.indexOf(target) : -1;
    if (!gesture.moved) {
      const sourceId = visibleSortableTreeIds(treeNodes, expandedIds)[gesture.sourceIndex];
      layerPointerRef.current = null;
      if (sourceId) selectLayer(sourceId);
      return;
    }
    const details = target && targetIndex >= 0
      ? getPointerTreeMove(
        treeNodes,
        expandedIds,
        gesture.sourceIndex,
        targetIndex,
        event.clientY,
        target.getBoundingClientRect().top,
        target.getBoundingClientRect().height
      )
      : null;
    layerPointerRef.current = null;
    if (details) {
      event.preventDefault();
      onTreeMove(treeNodes, details);
    }
  };

  const layerTreePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (layerPointerRef.current?.pointerId === event.pointerId) {
      layerPointerRef.current = null;
    }
  };

  if (!persistenceReady) {
    return (
      <main className="editor-shell" aria-live="polite">
        {persistenceStatus === 'retrying' ? 'Retrying working document recovery...' : 'Recovering working document...'}
      </main>
    );
  }

  return (
    <main className="editor-shell">
      <header className="editor-topbar editor-chrome">
        <div className="brand editor-brand"><strong>VANTA</strong><span>Image compositor</span></div>
        <nav className="menu-strip" aria-label="Main menu">
          <button type="button">File</button><button type="button">Edit</button><button type="button">Layer</button><button type="button">View</button>
        </nav>
        <div className="editor-actions">
          <button type="button" aria-label="Undo" disabled={!historyRef.current.canUndo} onClick={undo}>Undo</button>
          <button type="button" aria-label="Redo" disabled={!historyRef.current.canRedo} onClick={redo}>Redo</button>
          <button type="button" aria-label="Fit" onClick={fit}>Fit</button>
          <button type="button" aria-label="Save JSON" onClick={saveJson}>Save JSON</button>
          <button type="button" aria-label="Load JSON" onClick={() => jsonFileRef.current?.click()}>Load JSON</button>
          <button type="button" aria-label="Import PSD" onClick={() => psdFileRef.current?.click()}>Import PSD</button>
          <button type="button" aria-label="Export PSD" onClick={() => void savePsd()}>Export PSD</button>
          <button type="button" aria-label="Toggle snapping" aria-pressed={snapSettings.enabled} onClick={() => setSnapSettings(settings => ({ ...settings, enabled: !settings.enabled }))}>Snap</button>
          <button type="button" aria-label="Toggle grid" aria-pressed={snapSettings.grid} onClick={() => setSnapSettings(settings => ({ ...settings, grid: !settings.grid }))}>Grid</button>
          <button type="button" aria-label="Toggle guides" aria-pressed={snapSettings.guides} onClick={() => setSnapSettings(settings => ({ ...settings, guides: !settings.guides }))}>Guides</button>
          <button type="button" aria-label="Toggle rulers" aria-pressed={showRulers} onClick={() => setShowRulers(value => !value)}>Rulers</button>
          <input ref={jsonFileRef} className="sr-only" aria-label="Open editor JSON file" type="file" accept="application/json,.json" onChange={event => void loadJson(event.target.files?.[0])} />
          <input ref={imageFileRef} className="sr-only" aria-label="Import image file" type="file" accept="image/*" onChange={event => void addImage(event.target.files?.[0])} />
          <input ref={psdFileRef} className="sr-only" aria-label="Import PSD file" type="file" accept="image/vnd.adobe.photoshop,.psd" onChange={event => void loadPsd(event.target.files?.[0])} />
        </div>
      </header>
      <div className="document-tabs" role="tablist" aria-label="Documents">
        <button className="document-tab" type="button" role="tab" aria-selected="true">Night Market.editor <span aria-hidden="true">*</span></button>
      </div>
      <section className="editor-main">
        <aside className="tool-rail" role="toolbar" aria-label="Tools">
          <button ref={moveToolRef} className={`tool-button ${tool === 'move' ? 'tool-button--active' : ''}`} type="button" aria-label="Move tool" aria-pressed={tool === 'move'} onClick={() => setTool('move')}>MV</button>
          <button className={`tool-button ${tool === 'hand' ? 'tool-button--active' : ''}`} type="button" aria-label="Hand tool" aria-pressed={tool === 'hand'} onClick={() => setTool('hand')}>HN</button>
          <button ref={maskToolRef} className={`tool-button ${tool === 'mask' ? 'tool-button--active' : ''}`} type="button" aria-label="Mask brush tool" aria-pressed={tool === 'mask'} disabled={!selectedRaster?.maskEnabled} onClick={enterMaskTool}>MK</button>
          <button className="tool-button" type="button" aria-label="Import image layer" onClick={() => imageFileRef.current?.click()}>IM</button>
          <button className="tool-button" type="button" aria-label="Add image layer" onClick={() => addLayer('image')}>GN</button>
          <button className="tool-button" type="button" aria-label="Add text layer" onClick={() => addLayer('text')}>TX</button>
          <button className="tool-button" type="button" aria-label="Add shape layer" onClick={() => addLayer('shape')}>SH</button>
          <button className="tool-button" type="button" aria-label="Add group" onClick={() => addLayer('group')}>GR</button>
          <button className="tool-button" type="button" aria-label="Add adjustment layer" onClick={() => addLayer('adjustment')}>AD</button>
        </aside>
        <section
          ref={workspaceRef}
          className="workspace canvas-workspace"
          data-testid="canvas-workspace"
          aria-label="Canvas workspace"
          aria-describedby="canvas-instructions"
          aria-keyshortcuts={tool === 'mask'
            ? 'ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space E Control+Z Meta+Z Control+Shift+Z Meta+Shift+Z'
            : 'ArrowLeft ArrowRight ArrowUp ArrowDown Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown'}
          tabIndex={0}
          onKeyDown={canvasKeyDown}
          onWheel={event => setZoom(value => Math.max(0.1, Math.min(4, value * Math.exp(-event.deltaY * 0.0015))))}
        >
          <p id="canvas-instructions" className="sr-only">
            {tool === 'mask'
              ? 'Mask brush: arrow keys move the brush. Enter or Space applies it. E switches erase and reveal. Shift moves ten pixels. Control or Command plus Z undoes; add Shift to redo.'
              : 'Arrow keys move. Alt plus arrows resize. Brackets rotate. Shift changes by ten.'}
          </p>
          <p id="mask-keyboard-state" className="sr-only" role="status" data-testid="mask-keyboard-state">
            {maskAnnouncement}
          </p>
          <div
            className="workspace-viewport"
            onPointerDown={workspacePointerDownWithCompositor}
            onPointerMove={workspacePointerMove}
            onPointerUp={workspacePointerUp}
            onPointerCancel={workspacePointerCancel}
            onLostPointerCapture={workspacePointerCancel}
          >
            <div
              className={`canvas-stage checkerboard ${tool === 'mask' ? 'canvas-stage-mask' : ''}`}
              style={{
                width: documentValue.width,
                height: documentValue.height,
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                backgroundImage: snapSettings.grid ? `linear-gradient(to right, rgb(255 255 255 / 10%) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 10%) 1px, transparent 1px)` : undefined,
                backgroundSize: snapSettings.grid ? `${snapSettings.gridSize}px ${snapSettings.gridSize}px` : undefined,
              }}
            >
              {showRulers ? (
                <>
                  <span className="geometry-ruler geometry-ruler--top" aria-hidden="true" />
                  <span className="geometry-ruler geometry-ruler--left" aria-hidden="true" />
                </>
              ) : null}
              <CompositorCanvas ref={canvasRef} width={documentValue.width} height={documentValue.height} hidden={backend !== 'webgpu' && backend !== 'webgl2'} />
              <canvas ref={fallbackCanvasRef} width={documentValue.width} height={documentValue.height} data-testid="compatibility-canvas" aria-label="Canvas 2D compatibility renderer" hidden={backend === 'webgpu' || backend === 'webgl2'} />
              {selectionStyle ? (
                <div
                  className="selection-box"
                  data-testid="selection-box"
                  role="group"
                  aria-label={`${selectedRaster?.name || 'Selected layer'} transform controls`}
                  aria-describedby="transform-state"
                  style={selectionStyle}
                  onPointerDown={event => startTransform(event)}
                  onPointerMove={updateTransform}
                  onPointerUp={finishTransform}
                  onPointerCancel={finishTransform}
                >
                  <button
                    className="rotate-handle"
                    type="button"
                    aria-label={transformHandleLabel('rotate', selectedRaster?.name ?? 'Selected layer')}
                    aria-describedby="transform-state"
                    aria-keyshortcuts="ArrowLeft ArrowRight"
                    onKeyDown={event => transformHandleKeyDown(event, undefined, true)}
                    onPointerDown={event => startTransform(event, undefined, true)}
                    onPointerMove={updateTransform}
                    onPointerUp={finishTransform}
                    onPointerCancel={finishTransform}
                  />
                  {handles.map(handle => (
                    <button
                      key={handle.handle}
                      className={`resize-handle resize-handle--${handle.handle}`}
                      type="button"
                      aria-label={transformHandleLabel(handle.handle, selectedRaster?.name ?? 'Selected layer')}
                      aria-describedby="transform-state"
                      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                      data-testid={handle.handle === 'se' ? 'handle-se' : undefined}
                      onKeyDown={event => transformHandleKeyDown(event, handle.handle)}
                      onPointerDown={event => startTransform(event, handle.handle)}
                      onPointerMove={updateTransform}
                      onPointerUp={finishTransform}
                      onPointerCancel={finishTransform}
                    />
                  ))}
                </div>
              ) : null}
              {selectedRaster ? (
                <p id="transform-state" className="sr-only" data-testid="transform-state" aria-live="polite">
                  {transformState(selectedRaster.name, selectedRaster.bounds, selectedRaster.rotation, selectedRaster.locked)}
                  . Use arrow keys on a resize handle to resize. Use Left and Right on the rotate handle to rotate.
                </p>
              ) : null}
              {tool === 'mask' && selectedRaster?.maskEnabled && maskCursor ? (
                <span
                  className="mask-keyboard-cursor"
                  data-testid="mask-keyboard-cursor"
                  aria-hidden="true"
                  style={{ left: selectedRaster.bounds.x + maskCursor.x, top: selectedRaster.bounds.y + maskCursor.y }}
                />
              ) : null}
              {snapGuides.map((guide, index) => (
                <span
                  key={`${guide.orientation}-${guide.position}-${index}`}
                  className={`smart-guide smart-guide--${guide.orientation}`}
                  style={guide.orientation === 'vertical' ? { left: guide.position } : { top: guide.position }}
                  aria-hidden="true"
                />
              ))}
            </div>
          </div>
          <div className="zoom-control"><span data-testid="zoom-value">{Math.round(zoom * 100)}%</span></div>
          {backend === 'initializing' ? <p className="loading-note">Initializing GPU compositor...</p> : null}
        </section>
        <aside className="dock" role="complementary" aria-label="Editor panels">
          <div className="dock-tabs" role="tablist" aria-label="Panel tabs"><button className="dock-tab dock-tab--active" type="button" role="tab" aria-selected="true">Layers</button><button className="dock-tab" type="button" role="tab" aria-selected="false">Properties</button></div>
          <section className="dock-section dock--layers" aria-labelledby="layers-heading">
            <div className="section-heading"><h2 id="layers-heading">Layers</h2><span>{documentValue.layers.length}</span></div>
            <div className="layer-toolbar">
              <button type="button" aria-label="Duplicate selected layer" disabled={!selected} onClick={duplicateSelected}>Duplicate</button>
              <button type="button" aria-label="Delete selected layer" disabled={!selected} onClick={deleteSelected}>Delete</button>
              <button type="button" aria-label="Toggle mask" aria-pressed={selectedRaster?.maskEnabled ?? false} disabled={!selectedRaster} onClick={toggleMask}>Mask</button>
              <button type="button" aria-label="Toggle clipping" disabled={!selectedRaster} onClick={() => selectedRaster && patchSelected('Toggle clipping', { clipped: !selectedRaster.clipped })}>Clip</button>
              <button
                type="button"
                aria-label="Mask brush erase mode"
                aria-pressed={maskErase}
                disabled={!selectedRaster?.maskEnabled}
                onClick={() => {
                  const next = toggleMaskBrushMode(maskErase ? 'erase' : 'reveal');
                  setMaskErase(next === 'erase');
                  if (selectedRaster) {
                    setMaskAnnouncement(maskKeyboardState(
                      selectedRaster.name,
                      maskCursor ?? maskCursorCenter(selectedRaster.bounds),
                      next,
                      `${next === 'erase' ? 'Erase' : 'Reveal'} mode selected.`
                    ));
                  }
                }}
              >{maskErase ? 'Erase mask' : 'Reveal mask'}</button>
            </div>
            <div
              className="layer-tree-pointer-surface"
              onPointerDownCapture={layerTreePointerDown}
              onPointerMoveCapture={layerTreePointerMove}
              onPointerUpCapture={layerTreePointerUp}
              onPointerCancelCapture={layerTreePointerCancel}
              onDragStartCapture={event => event.preventDefault()}
              style={{ touchAction: 'none' }}
            >
              <SortableTree
                className="layer-tree"
                aria-label="Document layers"
                nodes={treeNodes}
                selectedId={documentValue.selectedLayerId}
                onSelectedIdChange={selectLayer}
                expandedIds={expandedIds}
                onExpandedIdsChange={next => {
                  let after = documentValue;
                  for (const layer of documentValue.layers) {
                    if (layer.kind === 'group' && layer.collapsed === next.has(layer.id)) after = updateLayer(after, layer.id, { collapsed: !next.has(layer.id) });
                  }
                  if (after !== documentValue) commit('Toggle group', after);
                }}
                onNodesChange={onTreeMove}
                renamingId={renamingId}
                onRenamingIdChange={setRenamingId}
                renderThumbnail={node => {
                  const layer = findLayer(documentValue, node.id);
                  if (!layer) return null;
                  if (layer.kind === 'group') return <span className="layer-kind layer-kind-group" data-testid={`layer-${layer.id}`}>GR</span>;
                  if (layer.kind === 'adjustment') return <span className="layer-kind layer-kind-adjustment" data-testid={`layer-${layer.id}`}>AD</span>;
                  return <img className="layer-thumbnail" data-testid={`layer-${layer.id}`} src={assetsRef.current.thumbnailFor(layer)} alt="" />;
                }}
                renderIcon={node => {
                  const layer = findLayer(documentValue, node.id);
                  return <span className="layer-indicators" aria-hidden="true">{layer?.maskEnabled ? 'M' : ''}{layer?.clipped ? 'C' : ''}</span>;
                }}
                renderActions={node => {
                  const layer = findLayer(documentValue, node.id);
                  if (!layer) return null;
                  return (
                    <span className="layer-actions">
                      <button type="button" aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`} onClick={() => commit('Toggle visibility', updateLayer(documentValue, layer.id, { visible: !layer.visible }))}>{layer.visible ? 'E' : '-'}</button>
                      <button type="button" aria-label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`} onClick={() => commit('Toggle lock', updateLayer(documentValue, layer.id, { locked: !layer.locked }))}>{layer.locked ? 'L' : 'U'}</button>
                      <button type="button" aria-label={`Rename ${layer.name}`} disabled={layer.locked} onClick={() => setRenamingId(layer.id)}>RN</button>
                    </span>
                  );
                }}
                renderRename={(node, { close }) => (
                  <input
                    className="layer-name"
                    aria-label={`${node.label} name`}
                    defaultValue={node.label}
                    autoFocus
                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') close(); }}
                    onBlur={event => {
                      const name = event.currentTarget.value.trim();
                      close();
                      if (name && name !== node.label) commit('Rename layer', updateLayer(documentValue, node.id, { name }));
                    }}
                  />
                )}
              />
            </div>
            <p className="layer-shortcuts">Drag thirds: before / nest / after. Cmd + arrows reorder.</p>
          </section>
          <section className="dock-section dock--properties" aria-labelledby="properties-heading">
            <div className="section-heading"><h2 id="properties-heading">Properties</h2></div>
            {selected ? (
              <div className="property-grid">
                <label className="property-control property-control--wide"><span>Opacity <output>{Math.round(selected.opacity * 100)}%</output></span><input aria-label="Opacity" type="range" min="0" max="1" step="0.01" value={selected.opacity} onChange={event => previewSelected('Change opacity', { opacity: Number(event.target.value) })} onPointerUp={() => finishProperty(documentValue)} onBlur={() => finishProperty(documentValue)} /></label>
                <label className="property-control property-control--wide"><span>Blend mode</span><select aria-label="Blend mode" value={selected.blendMode} onChange={event => patchSelected('Change blend mode', { blendMode: event.target.value as BlendMode })}><option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option></select></label>
                {selectedRaster ? GEOMETRY_CONTROLS.map(control => {
                  const value = control.key === 'rotation' ? selectedRaster.rotation : selectedRaster.bounds[control.key];
                  return (
                    <label className="property-control" key={control.key}>
                      <span>{control.label} <output>{value}{control.key === 'rotation' ? '°' : ''}</output></span>
                      <input
                        aria-label={control.label}
                        data-testid={`geometry-control-${control.key}`}
                        type="number"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={value}
                        onChange={event => updateSelectedGeometry(control.key, event.target.value)}
                        onBlur={() => finishProperty(documentValue)}
                      />
                    </label>
                  );
                }) : null}
                {selected?.kind === 'shape' ? (
                  <>
                    <label className="property-control property-control--wide"><span>Form</span><select aria-label="Shape form" value={selected.form} onChange={event => patchSelected('Change shape form', { form: event.target.value as typeof selected.form })}><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option><option value="triangle">Triangle</option></select></label>
                    <label className="property-control"><span>Fill</span><input aria-label="Shape fill" type="color" value={selected.fill} onChange={event => patchSelected('Change shape fill', { fill: event.target.value })} /></label>
                    <label className="property-control"><span>Stroke</span><input aria-label="Shape stroke" type="color" value={selected.stroke} onChange={event => patchSelected('Change shape stroke', { stroke: event.target.value })} /></label>
                    <label className="property-control"><span>Corner <output>{selected.cornerRadius}</output></span><input aria-label="Corner radius" type="number" min="0" max="4096" step="1" value={selected.cornerRadius} onChange={event => patchSelected('Change corner radius', { cornerRadius: Math.max(0, Number(event.target.value)) })} /></label>
                    <label className="property-control property-control--wide"><span>Path points</span><input aria-label="Shape path points" placeholder="x,y x,y ..." value={selected.path.map(point => `${point.x},${point.y}`).join(' ')} onChange={event => {
                      const path = event.target.value.trim() === '' ? [] : event.target.value.trim().split(/\s+/).map(pair => pair.split(',').map(Number)).map(([x, y]) => ({ x, y }));
                      if (path.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)) patchSelected('Change shape path', { path });
                    }} /></label>
                  </>
                ) : null}
                {(selected.kind === 'adjustment' ? ['brightness', 'contrast', 'saturation'] as const : ['brightness', 'contrast', 'saturation', 'blur'] as const).map(key => (
                  <label className="property-control" key={key}><span>{key[0]?.toUpperCase() + key.slice(1)}</span><input aria-label={key[0]?.toUpperCase() + key.slice(1)} type="range" min={key === 'blur' ? 0 : -1} max={key === 'blur' ? 20 : 1} step={key === 'blur' ? 1 : 0.1} value={selected.adjustments[key]} onChange={event => previewSelected(`Change ${key}`, { adjustments: { ...selected.adjustments, [key]: Number(event.target.value) } })} onPointerUp={() => finishProperty(documentValue)} onBlur={() => finishProperty(documentValue)} /></label>
                ))}
              </div>
            ) : <p className="lede">Select a layer.</p>}
          </section>
        </aside>
      </section>
      {failure ? <section className="failure-panel" role="alert" data-testid="failure-panel"><strong>{failure.kind}</strong><span>{failure.message}</span></section> : null}
      {message ? <section className="editor-message" role="alert" data-testid="editor-message">{message}</section> : null}
      <footer className="status-bar editor-status" role="status" aria-label="Editor status">
        <span><strong>Backend</strong> <output data-testid="backend">{backend}</output></span>
        <span><strong>Generation</strong> <output data-testid="compositor-generation">{compositorGeneration}</output></span>
        <span><strong>Secure</strong> <output data-testid="secure-context">{String(window.isSecureContext)}</output></span>
        <span><strong>Document</strong> {documentValue.width} x {documentValue.height}</span>
        <span><strong>Selected</strong> {selected?.name ?? 'None'}</span>
        <span><strong>Autosave</strong> <output data-testid="autosave-status">{persistenceStatus}</output></span>
        {showNestedGroupProof ? <>
          <span><strong>Nested group</strong> <output data-testid="nested-group-pixel">{nestedGroupPixel}</output></span>
          <span><strong>UI package</strong> <output data-testid="ui-package-version">{uiPackage.version}</output></span>
          <span><strong>Core pixel</strong> <output data-testid="open-pencil-core-pixel">{installedCorePixel}</output></span>
          <span className="sr-only"><strong>Core seeded pixel</strong> <output data-testid="open-pencil-core-seeded-pixel">{installedCoreSeededPixel}</output></span>
        </> : null}
        <span className="sr-only" data-testid="layer-order">{layerOrder}</span>
      </footer>
    </main>
  );
}
