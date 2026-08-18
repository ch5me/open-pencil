/* eslint-disable max-lines */
export type BlendMode = 'normal' | 'multiply' | 'screen';
export type LayerKind = 'image' | 'text' | 'shape' | 'group' | 'adjustment';
export type LayerMovePosition = 'before' | 'inside' | 'after';
export type ShapeForm = 'rectangle' | 'ellipse' | 'triangle';
export interface ShapePathPoint {
	readonly x: number;
	readonly y: number;
}
export type TextAlignment = 'left' | 'center' | 'right' | 'justified';
export type TextWrapping = 'none' | 'word' | 'character';

export interface LayerBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface LayerAdjustments {
	readonly brightness: number;
	readonly contrast: number;
	readonly saturation: number;
	readonly blur: number;
}

interface LayerBase {
	readonly id: string;
	readonly name: string;
	readonly kind: LayerKind;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly opacity: number;
	readonly blendMode: BlendMode;
	readonly parentId: string | null;
	readonly maskEnabled: boolean;
	readonly maskAssetId: string | null;
	readonly clipped: boolean;
	readonly adjustments: LayerAdjustments;
}

interface RenderableLayer extends LayerBase {
	readonly bounds: LayerBounds;
	readonly rotation: number;
}

export interface ImageLayer extends RenderableLayer {
	readonly kind: 'image';
	readonly seed: string;
	readonly assetId: string | null;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly sourceResolution: number;
	readonly crop: CropRect | null;
}

export type RasterPaintTool =
  'brush' |
  'eraser' |
  'clone-stamp' |
  'healing' |
  'dodge' |
  'burn' |
  'smudge' |
  'blur' |
  'sharpen' |
  'fill-bucket' |
  'gradient';

export type EditorSelectionTool =
  'marquee' |
  'lasso' |
  'polygon' |
  'magic-wand' |
  'subject' |
  'background';

export interface EditorSelectionRequest {
	readonly layerId: string;
	readonly tool: EditorSelectionTool;
	readonly x?: number;
	readonly y?: number;
}

export type PathEditTool = 'pen' | 'anchor';

export interface PathEditRequest {
	readonly layerId: string;
	readonly tool: PathEditTool;
	readonly x?: number;
	readonly y?: number;
	readonly anchorIndex?: number;
}

export interface RasterPaintRequest {
	readonly layerId: string;
	readonly tool: RasterPaintTool;
	readonly x: number;
	readonly y: number;
	readonly radius: number;
	readonly opacity: number;
	readonly color?: string;
}

export type ImageLayerPatch = Partial<Pick<ImageLayer,
	'seed' | 'assetId' | 'sourceWidth' | 'sourceHeight' | 'sourceResolution' | 'crop'
>>;

export interface TextLayer extends RenderableLayer {
	readonly kind: 'text';
	readonly content: string;
	readonly fontFamily: string;
	readonly color: string;
	readonly fontSize: number;
	readonly fontWeight: number;
	readonly alignment: TextAlignment;
	readonly letterSpacing: number;
	readonly lineHeight: number;
	readonly wrapping: TextWrapping;
}

export type TextLayerPatch = Partial<Pick<TextLayer,
  'content' | 'fontFamily' | 'color' | 'fontSize' | 'fontWeight' | 'alignment' |
  'letterSpacing' | 'lineHeight' | 'wrapping'
>>;

export type EditorCapabilityCode =
  'E_CAPABILITY_TEXT_EDIT_UNAVAILABLE' |
  'E_CAPABILITY_SHAPE_EDIT_UNAVAILABLE' |
  'E_CAPABILITY_IMAGE_EDIT_UNAVAILABLE' |
  'E_CAPABILITY_RASTER_PAINT_UNAVAILABLE' |
  'E_CAPABILITY_SELECTION_UNAVAILABLE' |
  'E_CAPABILITY_PATH_EDIT_UNAVAILABLE';

export class EditorCapabilityError extends Error {
	readonly code: EditorCapabilityCode;

	constructor(code: EditorCapabilityCode, message: string) {
		super(`${code}: ${message}`);
		this.name = 'EditorCapabilityError';
		this.code = code;
	}
}

export interface ShapeLayer extends RenderableLayer {
	readonly kind: 'shape';
	readonly form: ShapeForm;
	readonly fill: string;
	readonly stroke: string;
	readonly cornerRadius: number;
	readonly path: ReadonlyArray<ShapePathPoint>;
}

export type ShapeLayerPatch = Partial<Pick<ShapeLayer, 'form' | 'fill' | 'stroke' | 'cornerRadius' | 'path'>>;

export interface GroupLayer extends LayerBase {
	readonly kind: 'group';
	readonly collapsed: boolean;
}

export interface AdjustmentLayer extends LayerBase {
	readonly kind: 'adjustment';
}

export type EditorLayer = ImageLayer | TextLayer | ShapeLayer | GroupLayer | AdjustmentLayer;

export interface EditorDocument {
	readonly version: 1;
	readonly width: number;
	readonly height: number;
	readonly layers: ReadonlyArray<EditorLayer>;
	readonly selectedLayerId: string | null;
}

export interface EditorImageSize {
	readonly width: number;
	readonly height: number;
}

export interface CropRect extends EditorImageSize {
	readonly x: number;
	readonly y: number;
}

export type CanvasAnchor =
  | 'top-left' | 'top-center' | 'top-right' |
  'center-left' | 'center' | 'center-right' |
  'bottom-left' | 'bottom-center' | 'bottom-right';

export interface CanvasResizeOptions {
	readonly anchor?: CanvasAnchor;
	readonly preserveContent?: boolean;
}

const MAX_DOCUMENT_DIMENSION = 8192;
const MAX_DOCUMENT_PIXELS = 67_108_864;
const MAX_LAYER_PIXELS = 33_554_432;
const MAX_LAYERS = 512;
const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 256;
const MAX_TEXT_LENGTH = 10_000;
const MAX_ROTATION = 360;

const DEFAULT_ADJUSTMENTS: LayerAdjustments = {
	brightness: 0,
	contrast: 0,
	saturation: 0,
	blur: 0
};

const commonLayer = (id: string, name: string, kind: LayerKind, parentId: string | null): LayerBase => ({
	id,
	name,
	kind,
	visible: true,
	locked: false,
	opacity: 1,
	blendMode: 'normal',
	parentId,
	maskEnabled: false,
	maskAssetId: null,
	clipped: false,
	adjustments: { ...DEFAULT_ADJUSTMENTS }
});

export function createEditorDocument(): EditorDocument {
	return {
		version: 1,
		width: 960,
		height: 640,
		selectedLayerId: 'headline',
		layers: [
			{
				...commonLayer('headline', 'Night market', 'text', null),
				kind: 'text',
				bounds: { x: 86, y: 72, width: 560, height: 92 },
				rotation: 0,
				content: 'NIGHT MARKET',
				fontFamily: 'Avenir Next',
				color: '#f7e6bd',
				fontSize: 68,
				fontWeight: 800,
				alignment: 'left',
				letterSpacing: 0,
				lineHeight: 1.2,
				wrapping: 'word'
			},
			{
				...commonLayer('seal', 'Vermilion seal', 'shape', null),
				kind: 'shape',
				bounds: { x: 754, y: 76, width: 112, height: 112 },
				rotation: 0,
				form: 'rectangle',
				fill: '#c94432',
				stroke: '#7b251e',
				cornerRadius: 12,
				path: []
			},
			{
				...commonLayer('artwork', 'Jade artwork', 'group', null),
				kind: 'group',
				collapsed: false
			},
			{
				...commonLayer('jade-fan', 'Jade fan', 'image', 'artwork'),
				kind: 'image',
				bounds: { x: 190, y: 180, width: 580, height: 350 },
				rotation: 0,
				seed: 'jade-fan-01',
				assetId: null,
				sourceWidth: 580,
				sourceHeight: 350,
				sourceResolution: 72,
				crop: null
			},
			{
				...commonLayer('caption', 'Market caption', 'text', 'artwork'),
				kind: 'text',
				bounds: { x: 280, y: 520, width: 400, height: 42 },
				rotation: 0,
				content: 'HAND-PRINTED AFTER DARK',
				fontFamily: 'Avenir Next',
				color: '#d8eadf',
				fontSize: 24,
				fontWeight: 800,
				alignment: 'left',
				letterSpacing: 0,
				lineHeight: 1.2,
				wrapping: 'word'
			},
			{
				...commonLayer('paper', 'Washi paper', 'image', null),
				kind: 'image',
				bounds: { x: 0, y: 0, width: 960, height: 640 },
				rotation: 0,
				seed: 'washi-paper-01',
				assetId: null,
				sourceWidth: 960,
				sourceHeight: 640,
				sourceResolution: 72,
				crop: null
			}
		]
	};
}

export function findLayer(document: EditorDocument, id: string): EditorLayer | undefined {
	return document.layers.find(layer => layer.id === id);
}

export function selectLayer(document: EditorDocument, id: string | null): EditorDocument {
	if (id !== null && !findLayer(document, id)) {
		throw new Error(`Unknown editor layer: ${id}`);
	}
	if (document.selectedLayerId === id) {
		return document;
	}
	return { ...document, selectedLayerId: id };
}

function validateCanvasSize(width: number, height: number): EditorImageSize {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
		throw new RangeError(`Canvas size must be whole pixels between 1 and ${MAX_DOCUMENT_DIMENSION}`);
	}
	if (width < 1 || height < 1 || width > MAX_DOCUMENT_DIMENSION || height > MAX_DOCUMENT_DIMENSION) {
		throw new RangeError(`Canvas size must be whole pixels between 1 and ${MAX_DOCUMENT_DIMENSION}`);
	}
	if (width * height > MAX_DOCUMENT_PIXELS) {
		throw new RangeError(`Canvas exceeds ${MAX_DOCUMENT_PIXELS} pixels`);
	}
	return { width, height };
}

function anchorOffset(
	oldSize: EditorImageSize,
	newSize: EditorImageSize,
	anchor: CanvasAnchor
): { x: number; y: number } {
	const horizontal = anchor.endsWith('left') ?
		0 :
		(anchor.endsWith('right') ?
			newSize.width - oldSize.width :
			(newSize.width - oldSize.width) / 2);
	const vertical = anchor.startsWith('top') ?
		0 :
		(anchor.startsWith('bottom') ?
			newSize.height - oldSize.height :
			(newSize.height - oldSize.height) / 2);
	return { x: horizontal, y: vertical };
}

function offsetLayer(layer: EditorLayer, x: number, y: number): EditorLayer {
	if (layer.kind === 'group' || layer.kind === 'adjustment') {
		return layer;
	}
	return { ...layer, bounds: { ...layer.bounds, x: layer.bounds.x + x, y: layer.bounds.y + y } };
}

export function getEditorImageSize(document: EditorDocument): EditorImageSize {
	return { width: document.width, height: document.height };
}

export function resizeEditorCanvas(
	document: EditorDocument,
	width: number,
	height: number,
	options: CanvasResizeOptions = {}
): EditorDocument {
	const size = validateCanvasSize(width, height);
	const anchor = options.anchor ?? 'center';
	if (!['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right',
		'bottom-left', 'bottom-center', 'bottom-right'].includes(anchor)) {
		throw new RangeError(`Unsupported canvas anchor: ${anchor}`);
	}
	const preserveContent = options.preserveContent ?? true;
	const offset = preserveContent ? anchorOffset(document, size, anchor) : { x: 0, y: 0 };
	return {
		...document,
		width: size.width,
		height: size.height,
		layers: offset.x === 0 && offset.y === 0 ?
			document.layers.slice() :
			document.layers.map(layer => offsetLayer(layer, offset.x, offset.y))
	};
}

export function cropEditorDocument(document: EditorDocument, crop: CropRect): EditorDocument {
	if (!Number.isSafeInteger(crop.x) || !Number.isSafeInteger(crop.y)) {
		throw new RangeError('Crop rectangle must be a whole-pixel region inside the document');
	}
	const outside = [
		crop.x < 0,
		crop.y < 0,
		crop.width < 1,
		crop.height < 1,
		crop.x + crop.width > document.width,
		crop.y + crop.height > document.height
	].some(Boolean);
	if (outside) {
		throw new RangeError('Crop rectangle must be a whole-pixel region inside the document');
	}
	validateCanvasSize(crop.width, crop.height);
	return {
		...document,
		width: crop.width,
		height: crop.height,
		layers: document.layers.map(layer => offsetLayer(layer, -crop.x, -crop.y))
	};
}

export function updateLayer(document: EditorDocument, id: string, patch: Partial<EditorLayer>): EditorDocument {
	const index = document.layers.findIndex(layer => layer.id === id);
	if (index === -1) {
		throw new Error(`Unknown editor layer: ${id}`);
	}
	const previous = document.layers[index];
	const candidate = parseLayer({ ...previous, ...patch, id: previous.id, kind: previous.kind });
	const layers = document.layers.slice();
	layers[index] = candidate;
	return { ...document, layers };
}

export function updateTextLayer(
	document: EditorDocument,
	id: string,
	patch: TextLayerPatch
): EditorDocument {
	const layer = findLayer(document, id);
	if (!layer) {
		throw new Error(`Unknown editor layer: ${id}`);
	}
	if (layer.kind !== 'text') {
		throw new EditorCapabilityError(
			'E_CAPABILITY_TEXT_EDIT_UNAVAILABLE',
			`Layer ${id} does not support text editing`
		);
	}
	return updateLayer(document, id, patch);
}

export function updateImageLayer(
	document: EditorDocument,
	id: string,
	patch: ImageLayerPatch
): EditorDocument {
	const layer = findLayer(document, id);
	if (!layer) {
		throw new Error(`Unknown editor layer: ${id}`);
	}
	if (layer.kind !== 'image') {
		throw new EditorCapabilityError(
			'E_CAPABILITY_IMAGE_EDIT_UNAVAILABLE',
			`Layer ${id} does not support image editing`
		);
	}
	const sourceWidth = patch.sourceWidth ?? layer.sourceWidth;
	const sourceHeight = patch.sourceHeight ?? layer.sourceHeight;
	validateImageSourceSize(sourceWidth, sourceHeight);
	const sourceResolution = patch.sourceResolution ?? layer.sourceResolution;
	validateImageSourceResolution(sourceResolution);
	const crop = patch.crop === undefined ? layer.crop : patch.crop;
	validateImageCrop(crop, sourceWidth, sourceHeight);
	return updateLayer(document, id, {
		...patch,
		sourceWidth,
		sourceHeight,
		sourceResolution,
		crop: crop === null ? null : { ...crop }
	});
}

function validateImageSourceSize(width: number, height: number): void {
	const invalidDimensions = [
		!Number.isSafeInteger(width),
		!Number.isSafeInteger(height),
		width < 1,
		height < 1,
		width > MAX_DOCUMENT_DIMENSION,
		height > MAX_DOCUMENT_DIMENSION
	].some(Boolean);
	if (invalidDimensions) {
		throw new RangeError('Image source size must be whole pixels within document limits');
	}
	if (width * height > MAX_LAYER_PIXELS) {
		throw new RangeError(`Image source exceeds ${MAX_LAYER_PIXELS} pixels`);
	}
}

function validateImageSourceResolution(resolution: number): void {
	if (!Number.isFinite(resolution) || resolution <= 0 || resolution > 100_000) {
		throw new RangeError('Image source resolution must be positive');
	}
}

function validateImageCrop(crop: CropRect | null, width: number, height: number): void {
	if (crop === null) {
		return;
	}
	const invalidCrop = [
		!Number.isSafeInteger(crop.x),
		!Number.isSafeInteger(crop.y),
		!Number.isSafeInteger(crop.width),
		!Number.isSafeInteger(crop.height),
		crop.x < 0,
		crop.y < 0,
		crop.width < 1,
		crop.height < 1,
		crop.x + crop.width > width,
		crop.y + crop.height > height
	].some(Boolean);
	if (invalidCrop) {
		throw new RangeError('Image crop must be a whole-pixel region inside the source');
	}
}

export function executeImageEdit(
	history: DocumentHistory,
	id: string,
	patch: ImageLayerPatch,
	label = 'Edit image'
): void {
	const before = history.document;
	const after = updateImageLayer(before, id, patch);
	history.execute(documentCommand(label, before, after));
}

/**
 * Raster paint stays an explicit capability gap until a real paint engine exists.
 * The typed request keeps callers on the semantic content-edit contract.
 */
export function executeRasterPaint(
	history: DocumentHistory,
	request: RasterPaintRequest,
	_label = 'Paint raster'
): void {
	if (!findLayer(history.document, request.layerId)) {
		throw new Error(`Unknown editor layer: ${request.layerId}`);
	}
	throw new EditorCapabilityError(
		'E_CAPABILITY_RASTER_PAINT_UNAVAILABLE',
		`Layer ${request.layerId} does not support raster paint`
	);
}

/**
 * Selection stays an explicit capability gap until a real selection engine exists.
 * The typed request keeps callers on the semantic content-edit contract.
 */
export function executeSelection(
	history: DocumentHistory,
	request: EditorSelectionRequest,
	_label = 'Select pixels'
): void {
	if (!findLayer(history.document, request.layerId)) {
		throw new Error(`Unknown editor layer: ${request.layerId}`);
	}
	throw new EditorCapabilityError(
		'E_CAPABILITY_SELECTION_UNAVAILABLE',
		`Layer ${request.layerId} does not support ${request.tool} selection`
	);
}

/**
 * Pen and anchor editing stay explicit capability gaps until a path engine
 * exists. Keep requests typed so callers do not mutate shape points directly.
 */
export function executePathEdit(
	history: DocumentHistory,
	request: PathEditRequest,
	_label = 'Edit path'
): void {
	if (!findLayer(history.document, request.layerId)) {
		throw new Error(`Unknown editor layer: ${request.layerId}`);
	}
	throw new EditorCapabilityError(
		'E_CAPABILITY_PATH_EDIT_UNAVAILABLE',
		`Layer ${request.layerId} does not support ${request.tool} path editing`
	);
}

function descendantsOf(layers: ReadonlyArray<EditorLayer>, id: string): Set<string> {
	const descendants = new Set<string>([id]);
	let previousSize = 0;
	while (previousSize !== descendants.size) {
		previousSize = descendants.size;
		for (const layer of layers) {
			if (layer.parentId !== null && descendants.has(layer.parentId)) {
				descendants.add(layer.id);
			}
		}
	}
	return descendants;
}

function copyId(id: string, used: Set<string>): string {
	const base = `${id}-copy`;
	if (!used.has(base)) {
		return base;
	}
	let suffix = 2;
	while (used.has(`${base}-${suffix}`)) {
		suffix += 1;
	}
	return `${base}-${suffix}`;
}

function copyLayer(layer: EditorLayer, id: string, parentId: string | null, rename: boolean): EditorLayer {
	const common = {
		...layer,
		id,
		name: rename ? `${layer.name} copy` : layer.name,
		parentId,
		adjustments: { ...layer.adjustments }
	};
	switch (layer.kind) {
		case 'image': {
			return {
				...common,
				kind: 'image',
				bounds: { ...layer.bounds },
				rotation: layer.rotation,
				seed: layer.seed,
				assetId: layer.assetId,
				sourceWidth: layer.sourceWidth,
				sourceHeight: layer.sourceHeight,
				sourceResolution: layer.sourceResolution,
				crop: layer.crop === null ? null : { ...layer.crop }
			};
		}
		case 'text': {
			return {
				...common,
				kind: 'text',
				bounds: { ...layer.bounds },
				rotation: layer.rotation,
				content: layer.content,
				fontFamily: layer.fontFamily,
				color: layer.color,
				fontSize: layer.fontSize,
				fontWeight: layer.fontWeight,
				alignment: layer.alignment,
				letterSpacing: layer.letterSpacing,
				lineHeight: layer.lineHeight,
				wrapping: layer.wrapping
			};
		}
		case 'shape': {
			return {
				...common,
				kind: 'shape',
				bounds: { ...layer.bounds },
				rotation: layer.rotation,
				form: layer.form,
				fill: layer.fill,
				stroke: layer.stroke,
				cornerRadius: layer.cornerRadius,
				path: layer.path.map(point => ({ ...point }))
			};
		}
		case 'group': {
			return { ...common, kind: 'group', collapsed: layer.collapsed };
		}
		case 'adjustment': {
			return { ...common, kind: 'adjustment' };
		}
		default: {
			return invalid('layer kind is unsupported');
		}
	}
}

export function duplicateLayer(
	document: EditorDocument,
	id: string
): { document: EditorDocument; selectedLayerId: string } {
	if (!findLayer(document, id)) {
		throw new Error(`Unknown editor layer: ${id}`);
	}
	const subtree = descendantsOf(document.layers, id);
	const sourceLayers = document.layers.filter(layer => subtree.has(layer.id));
	const used = new Set(document.layers.map(layer => layer.id));
	const ids = new Map<string, string>();
	for (const layer of sourceLayers) {
		const nextId = copyId(layer.id, used);
		used.add(nextId);
		ids.set(layer.id, nextId);
	}
	const selectedLayerId = ids.get(id);
	if (!selectedLayerId) {
		throw new Error(`Unknown editor layer: ${id}`);
	}
	const copies = sourceLayers.map(layer => copyLayer(
		layer,
		ids.get(layer.id) ?? layer.id,
		layer.parentId !== null && ids.has(layer.parentId) ? ids.get(layer.parentId) ?? null : layer.parentId,
		layer.id === id
	));
	let lastIndex = -1;
	for (const [index, layer] of document.layers.entries()) {
		if (subtree.has(layer.id)) {
			lastIndex = index;
		}
	}
	const layers = document.layers.slice();
	layers.splice(lastIndex + 1, 0, ...copies);
	return {
		document: { ...document, layers, selectedLayerId },
		selectedLayerId
	};
}

export function deleteLayer(document: EditorDocument, id: string): EditorDocument {
	const index = document.layers.findIndex(layer => layer.id === id);
	if (index === -1) {
		throw new Error(`Unknown editor layer: ${id}`);
	}
	const removed = descendantsOf(document.layers, id);
	const layers = document.layers.filter(layer => !removed.has(layer.id));
	const selectedLayerId = layers[Math.min(index, layers.length - 1)]?.id ?? null;
	return { ...document, layers, selectedLayerId };
}

function lockedLayer(layers: ReadonlyArray<EditorLayer>, layer: EditorLayer): EditorLayer | undefined {
	const byId = new Map(layers.map(candidate => [candidate.id, candidate]));
	let current: EditorLayer | undefined = layer;
	while (current) {
		if (current.locked) {
			return current;
		}
		current = current.parentId === null ? undefined : byId.get(current.parentId);
	}
	return undefined;
}

function lastSubtreeIndex(layers: ReadonlyArray<EditorLayer>, id: string): number {
	const subtree = descendantsOf(layers, id);
	let lastIndex = -1;
	for (const [index, layer] of layers.entries()) {
		if (subtree.has(layer.id)) {
			lastIndex = index;
		}
	}
	return lastIndex;
}

export function moveLayer(
	document: EditorDocument,
	id: string,
	targetId: string,
	position: LayerMovePosition
): EditorDocument {
	const moving = findLayer(document, id);
	if (!moving) {
		throw new Error(`Unknown editor layer: ${id}`);
	}
	const target = findLayer(document, targetId);
	if (!target) {
		throw new Error(`Unknown editor layer target: ${targetId}`);
	}
	if (!['before', 'inside', 'after'].includes(position)) {
		throw new Error(`Unsupported editor layer move position: ${position}`);
	}
	const subtree = descendantsOf(document.layers, id);
	if (subtree.has(target.id)) {
		throw new Error('Cannot move a layer relative to its own subtree');
	}
	const lockedSource = lockedLayer(document.layers, moving);
	if (lockedSource) {
		throw new Error(`Cannot move locked editor layer: ${lockedSource.id}`);
	}
	const lockedTarget = lockedLayer(document.layers, target);
	if (lockedTarget) {
		throw new Error(`Cannot move relative to locked editor layer: ${lockedTarget.id}`);
	}
	if (position === 'inside' && target.kind !== 'group') {
		throw new Error(`Editor layer target is not a group: ${targetId}`);
	}

	const parentId = position === 'inside' ? target.id : target.parentId;
	const block = document.layers
		.filter(layer => subtree.has(layer.id))
		.map(layer => layer.id === id ? copyLayer(layer, layer.id, parentId, false) : layer);
	const layers = document.layers.filter(layer => !subtree.has(layer.id));
	const insertionIndex = position === 'before' ?
		layers.findIndex(layer => layer.id === target.id) :
		lastSubtreeIndex(layers, target.id) + 1;
	if (insertionIndex < 0) {
		throw new Error(`Invalid editor layer target: ${targetId}`);
	}
	layers.splice(insertionIndex, 0, ...block);
	return { ...document, layers };
}

export function reorderLayer(
	document: EditorDocument,
	id: string,
	targetId: string | null,
	parentId: string | null
): EditorDocument {
	const moving = findLayer(document, id);
	if (!moving) {
		throw new Error(`Unknown editor layer: ${id}`);
	}
	const subtree = descendantsOf(document.layers, id);
	if (parentId !== null) {
		const parent = findLayer(document, parentId);
		if (!parent) {
			throw new Error(`Unknown editor layer parent: ${parentId}`);
		}
		if (parent.kind !== 'group') {
			throw new Error(`Editor layer parent is not a group: ${parentId}`);
		}
		if (subtree.has(parentId)) {
			throw new Error('Cannot move a layer into its own subtree');
		}
	}
	const target = targetId === null ? undefined : findLayer(document, targetId);
	if (targetId !== null && !target) {
		throw new Error(`Unknown editor layer target: ${targetId}`);
	}
	if (target && subtree.has(target.id)) {
		throw new Error('Cannot move a layer relative to its own subtree');
	}
	if (target && target.parentId !== parentId) {
		throw new Error('Editor layer target must belong to the destination parent');
	}

	const block = document.layers
		.filter(layer => subtree.has(layer.id))
		.map(layer => layer.id === id ? copyLayer(layer, layer.id, parentId, false) : layer);
	const layers = document.layers.filter(layer => !subtree.has(layer.id));
	let insertionIndex: number;
	if (target) {
		insertionIndex = layers.findIndex(layer => layer.id === target.id);
	} else if (parentId === null) {
		insertionIndex = layers.length;
	} else {
		const parentSubtree = descendantsOf(layers, parentId);
		insertionIndex = 0;
		for (const [index, layer] of layers.entries()) {
			if (parentSubtree.has(layer.id)) {
				insertionIndex = index + 1;
			}
		}
	}
	layers.splice(insertionIndex, 0, ...block);
	return { ...document, layers };
}

function invalid(message: string): never {
	throw new TypeError(`Invalid editor document: ${message}`);
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return invalid(`${name} must be an object`);
	}
	return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string, allowEmpty = false, maximum = MAX_NAME_LENGTH): string {
	if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0) || value.length > maximum) {
		return invalid(`${name} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
	}
	return value;
}

function numberValue(value: unknown, name: string, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		return invalid(`${name} must be between ${minimum} and ${maximum}`);
	}
	return value;
}

function wholeNumberValue(value: unknown, name: string, minimum: number, maximum: number): number {
	const number = numberValue(value, name, minimum, maximum);
	if (!Number.isSafeInteger(number)) {
		return invalid(`${name} must be a whole number`);
	}
	return number;
}

function booleanValue(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') {
		return invalid(`${name} must be a boolean`);
	}
	return value;
}

function optionalAssetId(value: unknown, name: string): string | null {
	return value === undefined || value === null ? null : stringValue(value, name, false, MAX_ID_LENGTH);
}

function enumValue<T extends string>(value: unknown, name: string, values: ReadonlyArray<T>): T {
	if (typeof value !== 'string' || !values.includes(value as T)) {
		return invalid(`${name} is unsupported`);
	}
	return value as T;
}

function parseBounds(value: unknown): LayerBounds {
	const source = record(value, 'layer bounds');
	const bounds = {
		x: numberValue(source.x, 'layer bounds x', -1_000_000, 1_000_000),
		y: numberValue(source.y, 'layer bounds y', -1_000_000, 1_000_000),
		width: numberValue(source.width, 'layer bounds width', Number.MIN_VALUE, MAX_DOCUMENT_DIMENSION),
		height: numberValue(source.height, 'layer bounds height', Number.MIN_VALUE, MAX_DOCUMENT_DIMENSION)
	};
	if (bounds.width * bounds.height > MAX_LAYER_PIXELS) {
		return invalid(`layer bounds exceed ${MAX_LAYER_PIXELS} pixels`);
	}
	return bounds;
}

function parseCrop(value: unknown): CropRect {
	const source = record(value, 'image crop');
	const crop = {
		x: wholeNumberValue(source.x, 'image crop x', 0, MAX_DOCUMENT_DIMENSION),
		y: wholeNumberValue(source.y, 'image crop y', 0, MAX_DOCUMENT_DIMENSION),
		width: wholeNumberValue(source.width, 'image crop width', 1, MAX_DOCUMENT_DIMENSION),
		height: wholeNumberValue(source.height, 'image crop height', 1, MAX_DOCUMENT_DIMENSION)
	};
	return crop;
}

function parseRotation(value: unknown): number {
	return value === undefined ? 0 : numberValue(value, 'layer rotation', -MAX_ROTATION, MAX_ROTATION);
}

function parseShapePath(value: unknown): Array<ShapePathPoint> {
	if (!Array.isArray(value) || value.length > 128) {
		return invalid('shape path must be an array with at most 128 points');
	}
	return value.map((point, index) => {
		const source = record(point, `shape path point ${index}`);
		return {
			x: numberValue(source.x, `shape path point ${index} x`, 0, 1),
			y: numberValue(source.y, `shape path point ${index} y`, 0, 1)
		};
	});
}

function parseAdjustments(value: unknown): LayerAdjustments {
	const source = record(value, 'layer adjustments');
	return {
		brightness: numberValue(source.brightness, 'layer brightness', -100, 100),
		contrast: numberValue(source.contrast, 'layer contrast', -100, 100),
		saturation: numberValue(source.saturation, 'layer saturation', -100, 100),
		blur: numberValue(source.blur, 'layer blur', 0, 100)
	};
}

function parseLayer(value: unknown): EditorLayer {
	const source = record(value, 'layer');
	const kind = enumValue(source.kind, 'layer kind', ['image', 'text', 'shape', 'group', 'adjustment']);
	const parentId = source.parentId === null ? null : stringValue(source.parentId, 'layer parentId');
	const common = {
		id: stringValue(source.id, 'layer id', false, MAX_ID_LENGTH),
		name: stringValue(source.name, 'layer name', false, MAX_NAME_LENGTH),
		visible: booleanValue(source.visible, 'layer visible'),
		locked: booleanValue(source.locked, 'layer locked'),
		opacity: numberValue(source.opacity, 'layer opacity', 0, 1),
		blendMode: enumValue(source.blendMode, 'layer blendMode', ['normal', 'multiply', 'screen']),
		parentId,
		maskEnabled: booleanValue(source.maskEnabled, 'layer maskEnabled'),
		maskAssetId: optionalAssetId(source.maskAssetId, 'layer maskAssetId'),
		clipped: booleanValue(source.clipped, 'layer clipped'),
		adjustments: parseAdjustments(source.adjustments)
	};
	switch (kind) {
		case 'image': {
			return {
				...common,
				kind,
				bounds: parseBounds(source.bounds),
				rotation: parseRotation(source.rotation),
				seed: stringValue(source.seed, 'image seed', false, MAX_TEXT_LENGTH),
				assetId: optionalAssetId(source.assetId, 'image assetId'),
				sourceWidth: source.sourceWidth === undefined ?
					parseBounds(source.bounds).width :
					wholeNumberValue(source.sourceWidth, 'image sourceWidth', 1, MAX_DOCUMENT_DIMENSION),
				sourceHeight: source.sourceHeight === undefined ?
					parseBounds(source.bounds).height :
					wholeNumberValue(source.sourceHeight, 'image sourceHeight', 1, MAX_DOCUMENT_DIMENSION),
				sourceResolution: source.sourceResolution === undefined ?
					72 :
					numberValue(source.sourceResolution, 'image sourceResolution', Number.MIN_VALUE, 100_000),
				crop: source.crop === undefined || source.crop === null ?
					null :
					parseCrop(source.crop)
			};
		}
		case 'text': {
			return {
				...common,
				kind,
				bounds: parseBounds(source.bounds),
				rotation: parseRotation(source.rotation),
				content: stringValue(source.content, 'text content', true, MAX_TEXT_LENGTH),
				fontFamily: source.fontFamily === undefined ?
					'Avenir Next' :
					stringValue(source.fontFamily, 'text fontFamily'),
				color: stringValue(source.color, 'text color'),
				fontSize: numberValue(source.fontSize, 'text fontSize', Number.MIN_VALUE, 1000),
				fontWeight: source.fontWeight === undefined ?
					800 :
					numberValue(source.fontWeight, 'text fontWeight', 100, 900),
				alignment: source.alignment === undefined ?
					'left' :
					enumValue(source.alignment, 'text alignment', ['left', 'center', 'right', 'justified']),
				letterSpacing: source.letterSpacing === undefined ?
					0 :
					numberValue(source.letterSpacing, 'text letterSpacing', -100, 100),
				lineHeight: source.lineHeight === undefined ?
					1.2 :
					numberValue(source.lineHeight, 'text lineHeight', 0.1, 10),
				wrapping: source.wrapping === undefined ?
					'word' :
					enumValue(source.wrapping, 'text wrapping', ['none', 'word', 'character'])
			};
		}
		case 'shape': {
			return {
				...common,
				kind,
				bounds: parseBounds(source.bounds),
				rotation: parseRotation(source.rotation),
				form: enumValue(source.form, 'shape form', ['rectangle', 'ellipse', 'triangle']),
				fill: stringValue(source.fill, 'shape fill'),
				stroke: stringValue(source.stroke, 'shape stroke'),
				cornerRadius: source.cornerRadius === undefined ? 0 : numberValue(source.cornerRadius, 'shape cornerRadius', 0, 4096),
				path: source.path === undefined ? [] : parseShapePath(source.path)
			};
		}
		case 'group': {
			return { ...common, kind, collapsed: booleanValue(source.collapsed, 'group collapsed') };
		}
		case 'adjustment': {
			return { ...common, kind };
		}
		default: {
			return invalid('layer kind is unsupported');
		}
	}
}

function parseDocumentDimensions(source: Record<string, unknown>): { width: number; height: number } {
	const width = numberValue(source.width, 'width', 1, MAX_DOCUMENT_DIMENSION);
	const height = numberValue(source.height, 'height', 1, MAX_DOCUMENT_DIMENSION);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
		return invalid('dimensions must be whole pixels');
	}
	if (width * height > MAX_DOCUMENT_PIXELS) {
		return invalid(`document exceeds ${MAX_DOCUMENT_PIXELS} pixels`);
	}
	return { width, height };
}

function parseDocumentLayers(value: unknown): Array<EditorLayer> {
	if (!Array.isArray(value)) {
		return invalid('layers must be an array');
	}
	if (value.length > MAX_LAYERS) {
		return invalid(`document exceeds ${MAX_LAYERS} layers`);
	}
	return value.map(layer => parseLayer(layer));
}

export function parseEditorDocument(value: string | unknown): EditorDocument {
	let input = value;
	if (typeof value === 'string') {
		try {
			input = JSON.parse(value) as unknown;
		} catch {
			return invalid('JSON is malformed');
		}
	}
	const source = record(input, 'document');
	if (source.version !== 1) {
		return invalid('version is unsupported');
	}
	const { width, height } = parseDocumentDimensions(source);
	const layers = parseDocumentLayers(source.layers);
	const byId = new Map<string, EditorLayer>();
	for (const layer of layers) {
		if (byId.has(layer.id)) {
			return invalid(`duplicate layer id: ${layer.id}`);
		}
		byId.set(layer.id, layer);
	}
	for (const layer of layers) {
		if (layer.parentId === null) {
			continue;
		}
		const parent = byId.get(layer.parentId);
		if (!parent) {
			return invalid(`missing parent: ${layer.parentId}`);
		}
		if (parent.kind !== 'group') {
			return invalid(`parent is not a group: ${layer.parentId}`);
		}
		const visited = new Set<string>([layer.id]);
		let ancestor: EditorLayer | undefined = parent;
		while (ancestor) {
			if (visited.has(ancestor.id)) {
				return invalid('layer parent cycle');
			}
			visited.add(ancestor.id);
			ancestor = ancestor.parentId === null ? undefined : byId.get(ancestor.parentId);
		}
	}
	const selectedLayerId = source.selectedLayerId === null ?
		null :
		stringValue(source.selectedLayerId, 'selectedLayerId');
	if (selectedLayerId !== null && !byId.has(selectedLayerId)) {
		return invalid(`selected layer does not exist: ${selectedLayerId}`);
	}
	return { version: 1, width, height, layers, selectedLayerId };
}

export interface EditorCommand {
	readonly label: string;
	readonly before: EditorDocument;
	readonly after: EditorDocument;
	readonly undoEffect?: () => void;
	readonly redoEffect?: () => void;
}

export const EDITOR_HISTORY_LIMIT = 50;

export function documentCommand(
	label: string,
	before: EditorDocument,
	after: EditorDocument,
	effects: Pick<EditorCommand, 'undoEffect' | 'redoEffect'> = {}
): EditorCommand {
	if (label.trim().length === 0) {
		throw new Error('Editor command label must not be empty');
	}
	return { label, before, after, ...effects };
}

export function executeTextEdit(
	history: DocumentHistory,
	id: string,
	patch: TextLayerPatch,
	label = 'Edit text'
): void {
	const before = history.document;
	const after = updateTextLayer(before, id, patch);
	history.execute(documentCommand(label, before, after));
}

export function updateLayerSelection(history: DocumentHistory, id: string | null): void {
	history.updateSelection(id);
}

export function executeLayerSelection(history: DocumentHistory, id: string | null): void {
	updateLayerSelection(history, id);
}

export function updateShapeLayer(document: EditorDocument, id: string, patch: ShapeLayerPatch): EditorDocument {
	const layer = findLayer(document, id);
	if (!layer) {
		throw new Error(`Unknown editor layer: ${id}`);
	}
	if (layer.kind !== 'shape') {
		throw new EditorCapabilityError(
			'E_CAPABILITY_SHAPE_EDIT_UNAVAILABLE',
			`Layer ${id} does not support shape editing`
		);
	}
	return updateLayer(document, id, patch);
}

export function executeShapeEdit(
	history: DocumentHistory,
	id: string,
	patch: ShapeLayerPatch,
	label = 'Edit shape'
): void {
	const before = history.document;
	const after = updateShapeLayer(before, id, patch);
	history.execute(documentCommand(label, before, after));
}

export class DocumentHistory {
	private current: EditorDocument;
	private readonly undoStack: Array<EditorCommand> = [];
	private readonly redoStack: Array<EditorCommand> = [];

	constructor(document: EditorDocument, private readonly limit = EDITOR_HISTORY_LIMIT) {
		if (!Number.isSafeInteger(limit) || limit < 1) {
			throw new Error('Editor history limit must be a positive integer');
		}
		this.current = document;
	}

	get document(): EditorDocument {
		return this.current;
	}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	get retainedDocuments(): ReadonlyArray<EditorDocument> {
		return [
			this.current,
			...this.undoStack.flatMap(command => [command.before, command.after]),
			...this.redoStack.flatMap(command => [command.before, command.after])
		].filter((document, index, documents) => documents.indexOf(document) === index);
	}

	execute(command: EditorCommand): void {
		if (command.before !== this.current) {
			throw new Error('Editor command must start from the current document');
		}
		this.undoStack.push(command);
		if (this.undoStack.length > this.limit) {
			this.undoStack.shift();
		}
		this.redoStack.length = 0;
		this.current = command.after;
	}

	updateSelection(id: string | null): void {
		this.current = selectLayer(this.current, id);
	}

	undo(): void {
		const command = this.undoStack.at(-1);
		if (!command) {
			return;
		}
		const selectedLayerId = this.current.selectedLayerId;
		command.undoEffect?.();
		this.undoStack.pop();
		this.redoStack.push(command);
		this.current = preserveSelection(command.before, selectedLayerId);
	}

	redo(): void {
		const command = this.redoStack.at(-1);
		if (!command) {
			return;
		}
		const selectedLayerId = this.current.selectedLayerId;
		command.redoEffect?.();
		this.redoStack.pop();
		this.undoStack.push(command);
		this.current = preserveSelection(command.after, selectedLayerId);
	}

	reset(document: EditorDocument): void {
		this.current = document;
		this.undoStack.length = 0;
		this.redoStack.length = 0;
	}
}

function preserveSelection(document: EditorDocument, selectedLayerId: string | null): EditorDocument {
	return selectedLayerId === null || findLayer(document, selectedLayerId) ?
		selectLayer(document, selectedLayerId) :
		document;
}
