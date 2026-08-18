import type { Color, Layer, ParagraphStyle, Psd } from 'ag-psd';
import {
	parseEditorDocument,
	type BlendMode,
	type EditorDocument,
	type EditorLayer,
	type LayerAdjustments,
	type LayerBounds,
	type TextAlignment,
	type TextLayer,
	type TextWrapping
} from '../model/editor-document';
import { EditorAssetRegistry } from '../rendering/editor-asset-registry';

export interface PsdWarning {
	readonly code: string;
	readonly message: string;
	readonly layerId?: string;
}

export interface PsdImportResult {
	readonly document: EditorDocument;
	readonly warnings: ReadonlyArray<PsdWarning>;
}

export type PsdImportErrorCode = 'E_PSD_IMPORT_BUDGET' | 'E_PSD_IMPORT_CORRUPT';

export class PsdImportError extends Error {
	readonly code: PsdImportErrorCode;

	constructor(message: string, cause?: unknown, code: PsdImportErrorCode = 'E_PSD_IMPORT_CORRUPT') {
		super(`${code}: ${message}`);
		this.name = 'PsdImportError';
		this.code = code;
		if (cause !== undefined) {
			this.cause = cause;
		}
	}
}

export interface PsdExportResult {
	readonly buffer: ArrayBuffer;
	readonly warnings: ReadonlyArray<PsdWarning>;
}

const EMPTY_ADJUSTMENTS: LayerAdjustments = { brightness: 0, contrast: 0, saturation: 0, blur: 0 };
const SUPPORTED_BLEND_MODES = new Set<BlendMode>(['normal', 'multiply', 'screen']);
const MAX_PSD_BYTES = 128 * 1024 * 1024;
const MAX_PSD_DIMENSION = 8192;
const MAX_PSD_PIXELS = 33_554_432;
const PSD_HEADER_BYTES = 26;
type PsdRuntime = typeof import('ag-psd');

const loadPsdRuntime = (() => {
	let runtime: Promise<PsdRuntime> | undefined;
	return async (): Promise<PsdRuntime> => {
		runtime ??= import('ag-psd');
		return runtime;
	};
})();

function assertPsdImportBudget(buffer: ArrayBuffer): void {
	if (buffer.byteLength > MAX_PSD_BYTES) {
		throw new PsdImportError('PSD exceeds 128 MB import budget', undefined, 'E_PSD_IMPORT_BUDGET');
	}
	if (buffer.byteLength < PSD_HEADER_BYTES) {
		return;
	}
	const bytes = new Uint8Array(buffer, 0, PSD_HEADER_BYTES);
	if (String.fromCodePoint(...bytes.subarray(0, 4)) !== '8BPS') {
		return;
	}
	const view = new DataView(buffer, 0, PSD_HEADER_BYTES);
	const height = view.getUint32(14, false);
	const width = view.getUint32(18, false);
	if (width > MAX_PSD_DIMENSION || height > MAX_PSD_DIMENSION || width * height > MAX_PSD_PIXELS) {
		throw new PsdImportError(
			`PSD dimensions exceed editor budget: ${width}x${height}`,
			undefined,
			'E_PSD_IMPORT_BUDGET'
		);
	}
}

function commonLayer(
	id: string,
	name: string,
	kind: EditorLayer['kind'],
	parentId: string | null,
	layer: Layer
) {
	const blendMode = SUPPORTED_BLEND_MODES.has(layer.blendMode as BlendMode) ? layer.blendMode as BlendMode : 'normal';
	return {
		id,
		name,
		kind,
		visible: !layer.hidden,
		locked: Boolean(layer.protected?.position || layer.protected?.composite || layer.protected?.transparency),
		opacity: Math.max(0, Math.min(1, (layer.opacity ?? 255) / 255)),
		blendMode,
		parentId,
		maskEnabled: false,
		maskAssetId: null,
		clipped: Boolean(layer.clipping),
		adjustments: { ...EMPTY_ADJUSTMENTS }
	};
}

function boundsFor(layer: Layer): LayerBounds {
	const x = layer.left ?? 0;
	const y = layer.top ?? 0;
	return {
		x,
		y,
		width: Math.max(1, (layer.right ?? x + 1) - x),
		height: Math.max(1, (layer.bottom ?? y + 1) - y)
	};
}

function copyCanvas(source: HTMLCanvasElement, width = source.width, height = source.height): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(width));
	canvas.height = Math.max(1, Math.round(height));
	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('Canvas 2D context unavailable');
	}
	context.drawImage(source, 0, 0, canvas.width, canvas.height);
	return canvas;
}

function importMask(
	layer: Layer,
	bounds: LayerBounds,
	registry: EditorAssetRegistry
): { maskEnabled: boolean; maskAssetId: string | null } {
	const source = layer.mask?.canvas;
	const mask = layer.mask;
	if (!source || !mask || mask.disabled) {
		return { maskEnabled: false, maskAssetId: null };
	}
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(bounds.width));
	canvas.height = Math.max(1, Math.round(bounds.height));
	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('Canvas 2D context unavailable');
	}
	const left = (mask.left ?? layer.left ?? 0) - (layer.left ?? 0);
	const top = (mask.top ?? layer.top ?? 0) - (layer.top ?? 0);
	context.drawImage(source, left, top);
	return { maskEnabled: true, maskAssetId: registry.registerCanvas('mask', canvas) };
}

function adjustmentValues(layer: Layer): LayerAdjustments | undefined {
	const adjustment = layer.adjustment;
	if (!adjustment) {
		return undefined;
	}
	if (adjustment.type === 'brightness/contrast') {
		return {
			brightness: Math.max(-1, Math.min(1, (adjustment.brightness ?? 0) / 150)),
			contrast: Math.max(-1, Math.min(1, (adjustment.contrast ?? 0) / 100)),
			saturation: 0,
			blur: 0
		};
	}
	if (adjustment.type === 'hue/saturation') {
		const master = adjustment.master;
		return {
			brightness: 0,
			contrast: 0,
			saturation: Math.max(-1, Math.min(1, (master?.saturation ?? 0) / 100)),
			blur: 0
		};
	}
	return undefined;
}

function colorHex(color: Color | undefined): string {
	if (!color || !('r' in color) || !('g' in color) || !('b' in color)) {
		return '#ffffff';
	}
	const channel = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
	return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function textAlignment(value: ParagraphStyle['justification']): TextAlignment {
	switch (value) {
		case 'justify-center': {
			return 'center';
		}
		case 'justify-right': {
			return 'right';
		}
		case 'justify-all': {
			return 'justified';
		}
		default: {
			return 'left';
		}
	}
}

function textLineHeight(fontSize: number, leading: number | undefined): number {
	return leading && leading > 0 ? Math.max(0.1, Math.min(10, leading / fontSize)) : 1.2;
}

function textValues(source: Layer): Omit<TextLayer, keyof ReturnType<typeof commonLayer> | 'kind' | 'bounds' | 'rotation'> {
	const text = source.text;
	if (!text || typeof text.text !== 'string') {
		throw new Error('PSD text metadata is missing');
	}
	const style = text.style ?? text.styleRuns?.[0]?.style;
	const paragraph = text.paragraphStyle;
	const fontSize = Math.max(1, style?.fontSize ?? 12);
	const alignment = textAlignment(paragraph?.justification);
	const wrapping: TextWrapping = text.shapeType === 'point' ? 'none' : 'word';
	return {
		content: text.text,
		fontFamily: style?.font?.name || 'Avenir Next',
		color: colorHex(style?.fillColor),
		fontSize,
		fontWeight: style?.fauxBold ? 700 : 400,
		alignment,
		letterSpacing: Math.max(-100, Math.min(100, (style?.tracking ?? 0) * fontSize / 1000)),
		lineHeight: textLineHeight(fontSize, style?.leading),
		wrapping
	};
}

export async function importPsd(buffer: ArrayBuffer, registry: EditorAssetRegistry): Promise<PsdImportResult> {
	assertPsdImportBudget(buffer);
	const { readPsd } = await loadPsdRuntime();
	let psd: Psd;
	try {
		psd = readPsd(buffer, { skipCompositeImageData: true, skipThumbnail: true });
	} catch (error) {
		throw new PsdImportError('PSD container could not be decoded', error);
	}
	const warnings: Array<PsdWarning> = [];
	const layers: Array<EditorLayer> = [];
	let sequence = 0;

	const append = (children: ReadonlyArray<Layer>, parentId: string | null): void => {
		for (const source of children) {
			const id = `psd-${sequence += 1}`;
			const registeredAssets: Array<string> = [];
			try {
				const name = source.name?.trim() || `PSD layer ${sequence}`;
				if (source.blendMode && !SUPPORTED_BLEND_MODES.has(source.blendMode as BlendMode) && source.blendMode !== 'pass through') {
					warnings.push({ code: 'blend-mode-approximated', layerId: id, message: `${name}: ${source.blendMode} imported as normal.` });
				}
				if (source.children) {
					layers.push({
						...commonLayer(id, name, 'group', parentId, source),
						kind: 'group',
						blendMode: source.blendMode === 'pass through' ? 'normal' : commonLayer(id, name, 'group', parentId, source).blendMode,
						collapsed: source.opened === false
					});
					append(source.children, id);
					continue;
				}

				const adjustments = adjustmentValues(source);
				if (adjustments && source.adjustment) {
					layers.push({
						...commonLayer(id, name, 'adjustment', parentId, source),
						kind: 'adjustment',
						adjustments
					});
					if (source.adjustment.type !== 'brightness/contrast') {
						warnings.push({ code: 'adjustment-approximated', layerId: id, message: `${name}: ${source.adjustment.type} imported with supported controls only.` });
					}
					continue;
				}
				if (source.adjustment && !source.canvas) {
					warnings.push({ code: 'adjustment-skipped', layerId: id, message: `${name}: unsupported ${source.adjustment.type} adjustment has no raster fallback.` });
					continue;
				}
				if (source.text) {
					const bounds = boundsFor(source);
					layers.push({
						...commonLayer(id, name, 'text', parentId, source),
						kind: 'text',
						bounds,
						rotation: 0,
						...textValues(source)
					});
					continue;
				}
				if (!source.canvas) {
					warnings.push({ code: 'layer-skipped', layerId: id, message: `${name}: no readable raster content.` });
					continue;
				}

				const bounds = boundsFor(source);
				const mask = importMask(source, bounds, registry);
				if (mask.maskAssetId) {
					registeredAssets.push(mask.maskAssetId);
				}
				const base = {
					...commonLayer(id, name, 'image', parentId, source),
					...mask,
					bounds,
					rotation: 0
				};
				const assetId = registry.registerCanvas('image', copyCanvas(source.canvas, bounds.width, bounds.height));
				registeredAssets.push(assetId);
				layers.push({
					...base,
					kind: 'image',
					seed: id,
					assetId,
					sourceWidth: source.canvas.width,
					sourceHeight: source.canvas.height,
					sourceResolution: 72,
					crop: null
				});
			} catch (error) {
				for (const assetId of registeredAssets) {
					registry.removeAsset(assetId);
				}
				layers.push({
					...commonLayer(id, `PSD layer ${sequence}`, 'group', parentId, source),
					kind: 'group',
					collapsed: true
				});
				warnings.push({
					code: 'corrupt-asset-isolated',
					layerId: id,
					message: `PSD layer ${sequence} isolated after import failure: ${error instanceof Error ? error.message : 'unknown decode error'}.`
				});
			}
		}
	};

	append(psd.children ?? [], null);
	let documentValue: EditorDocument;
	try {
		documentValue = parseEditorDocument({
			version: 1,
			width: psd.width,
			height: psd.height,
			layers,
			selectedLayerId: layers[0]?.id ?? null
		});
	} catch (error) {
		throw new PsdImportError('PSD document failed editor validation', error);
	}
	return { document: documentValue, warnings };
}

function rotatedLayerCanvas(layer: Exclude<EditorLayer, { kind: 'group' | 'adjustment' }>, registry: EditorAssetRegistry) {
	let source = registry.sourceFor(layer);
	const mask = registry.maskFor(layer);
	if (mask) {
		const masked = copyCanvas(source);
		const context = masked.getContext('2d');
		if (!context) {
			throw new Error('Canvas 2D context unavailable');
		}
		context.globalCompositeOperation = 'destination-in';
		context.drawImage(mask, 0, 0, masked.width, masked.height);
		source = masked;
	}
	const radians = layer.rotation * Math.PI / 180;
	const width = Math.abs(layer.bounds.width * Math.cos(radians)) + Math.abs(layer.bounds.height * Math.sin(radians));
	const height = Math.abs(layer.bounds.width * Math.sin(radians)) + Math.abs(layer.bounds.height * Math.cos(radians));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.ceil(width));
	canvas.height = Math.max(1, Math.ceil(height));
	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('Canvas 2D context unavailable');
	}
	context.translate(canvas.width / 2, canvas.height / 2);
	context.rotate(radians);
	context.drawImage(source, -layer.bounds.width / 2, -layer.bounds.height / 2, layer.bounds.width, layer.bounds.height);
	return {
		canvas,
		left: Math.round(layer.bounds.x + layer.bounds.width / 2 - canvas.width / 2),
		top: Math.round(layer.bounds.y + layer.bounds.height / 2 - canvas.height / 2)
	};
}

function exportLayer(
	layer: EditorLayer,
	children: ReadonlyArray<EditorLayer>,
	registry: EditorAssetRegistry,
	warnings: Array<PsdWarning>
): Layer {
	const common: Layer = {
		name: layer.name,
		hidden: !layer.visible,
		opacity: Math.round(layer.opacity * 255),
		blendMode: layer.blendMode,
		clipping: layer.clipped,
		protected: layer.locked ? { transparency: true, composite: true, position: true } : undefined
	};
	if (layer.kind === 'group') {
		return {
			...common,
			opened: !layer.collapsed,
			children: children.filter(child => child.parentId === layer.id).map(child => exportLayer(child, children, registry, warnings))
		};
	}
	if (layer.kind === 'adjustment') {
		if (layer.adjustments.saturation !== 0 || layer.adjustments.blur !== 0) {
			warnings.push({ code: 'adjustment-partial', layerId: layer.id, message: `${layer.name}: saturation and blur are not represented by brightness/contrast PSD metadata.` });
		}
		return {
			...common,
			adjustment: {
				type: 'brightness/contrast',
				brightness: Math.round(layer.adjustments.brightness * 150),
				contrast: Math.round(layer.adjustments.contrast * 100),
				meanValue: 127,
				useLegacy: false,
				labColorOnly: false
			}
		};
	}

	const rendered = rotatedLayerCanvas(layer, registry);
	const exported: Layer = {
		...common,
		left: rendered.left,
		top: rendered.top,
		right: rendered.left + rendered.canvas.width,
		bottom: rendered.top + rendered.canvas.height,
		canvas: rendered.canvas
	};
	const mask = registry.maskFor(layer);
	if (mask && layer.rotation === 0) {
		exported.mask = {
			top: layer.bounds.y,
			left: layer.bounds.x,
			bottom: layer.bounds.y + layer.bounds.height,
			right: layer.bounds.x + layer.bounds.width,
			canvas: copyCanvas(mask),
			defaultColor: 255
		};
	}
	if (layer.kind === 'text') {
		warnings.push({ code: 'text-flattened', layerId: layer.id, message: `${layer.name}: exported as raster to preserve appearance.` });
	} else if (layer.kind === 'shape') {
		warnings.push({ code: 'shape-flattened', layerId: layer.id, message: `${layer.name}: exported as raster to preserve appearance.` });
	}
	if (layer.rotation !== 0) {
		warnings.push({ code: 'rotation-flattened', layerId: layer.id, message: `${layer.name}: rotation baked into raster pixels.` });
		if (mask) {
			warnings.push({ code: 'mask-flattened', layerId: layer.id, message: `${layer.name}: rotated mask baked into raster pixels.` });
		}
	}
	return exported;
}

export async function exportPsd(
	documentValue: EditorDocument,
	registry: EditorAssetRegistry,
	compositeCanvas: HTMLCanvasElement
): Promise<PsdExportResult> {
	const { writePsd } = await loadPsdRuntime();
	const warnings: Array<PsdWarning> = [];
	const psd: Psd = {
		width: documentValue.width,
		height: documentValue.height,
		canvas: copyCanvas(compositeCanvas, documentValue.width, documentValue.height),
		children: documentValue.layers
			.filter(layer => layer.parentId === null)
			.map(layer => exportLayer(layer, documentValue.layers, registry, warnings))
	};
	return { buffer: writePsd(psd), warnings };
}
