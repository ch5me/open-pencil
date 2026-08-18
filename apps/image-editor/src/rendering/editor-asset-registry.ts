import type { EditorLayer, ImageLayer, LayerBounds } from '../model/editor-document';

type RasterLayer = Exclude<EditorLayer, { kind: 'group' | 'adjustment' }>;
type AssetKind = 'image' | 'mask';

export interface SerializedEditorAsset {
	readonly kind: AssetKind;
	readonly dataUrl: string;
}

export type SerializedEditorAssets = Readonly<Record<string, SerializedEditorAsset>>;

export interface EditorMaskSnapshot {
	readonly id: string;
	readonly width: number;
	readonly height: number;
	readonly bytes: Uint8ClampedArray;
}

export class EditorArchiveBudgetError extends Error {
	readonly code = 'E_EDITOR_ARCHIVE_BUDGET';
}

const MAX_ASSETS = 512;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_SERIALIZED_BYTES = 128 * 1024 * 1024;
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 33_554_432;

function contextFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('Canvas 2D context unavailable');
	}
	return context;
}

function canvasFor(width: number, height: number): HTMLCanvasElement {
	const roundedWidth = Math.max(1, Math.round(width));
	const roundedHeight = Math.max(1, Math.round(height));
	if (roundedWidth > MAX_DIMENSION || roundedHeight > MAX_DIMENSION || roundedWidth * roundedHeight > MAX_PIXELS) {
		throw new Error(`Asset dimensions exceed editor budget: ${roundedWidth}x${roundedHeight}`);
	}
	const canvas = document.createElement('canvas');
	canvas.width = roundedWidth;
	canvas.height = roundedHeight;
	return canvas;
}

function assetId(prefix: AssetKind): string {
	return `${prefix}-${crypto.randomUUID()}`;
}

async function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener('error', () => reject(reader.error ?? new Error(`Could not read ${file.name}`)));
		reader.addEventListener('load', () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(`Could not read ${file.name}`)));
		reader.readAsDataURL(file);
	});
}

async function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.addEventListener('load', () => resolve(image));
		image.addEventListener('error', () => reject(new Error('Could not decode editor image asset')));
		image.src = dataUrl;
	});
}

function drawShape(
	context: CanvasRenderingContext2D,
	layer: Extract<RasterLayer, { kind: 'shape' }>,
	canvas: HTMLCanvasElement,
	inset: number
): void {
	context.beginPath();
	if (layer.path.length >= 3) {
		const first = layer.path[0];
		if (first) {
			context.moveTo(first.x * canvas.width, first.y * canvas.height);
		}
		for (const point of layer.path.slice(1)) {
			context.lineTo(point.x * canvas.width, point.y * canvas.height);
		}
		context.closePath();
	} else if (layer.form === 'ellipse') {
		context.ellipse(canvas.width / 2, canvas.height / 2, canvas.width / 2 - inset, canvas.height / 2 - inset, 0, 0, Math.PI * 2);
	} else if (layer.form === 'triangle') {
		context.moveTo(canvas.width / 2, inset);
		context.lineTo(canvas.width - inset, canvas.height - inset);
		context.lineTo(inset, canvas.height - inset);
		context.closePath();
	} else if (layer.cornerRadius > 0) {
		const radius = Math.min(layer.cornerRadius, canvas.width / 2, canvas.height / 2);
		context.roundRect(inset, inset, canvas.width - context.lineWidth, canvas.height - context.lineWidth, radius);
	} else {
		context.rect(inset, inset, canvas.width - context.lineWidth, canvas.height - context.lineWidth);
	}
	context.fill();
	context.stroke();
}

function renderGeneratedSource(layer: RasterLayer): HTMLCanvasElement {
	const canvas = canvasFor(layer.bounds.width, layer.bounds.height);
	const context = contextFor(canvas);
	const { brightness, contrast, saturation, blur } = layer.adjustments;
	context.filter = `brightness(${Math.max(0, 1 + brightness)}) contrast(${Math.max(0, 1 + contrast)}) saturate(${Math.max(0, 1 + saturation)}) blur(${blur}px)`;

	if (layer.kind === 'image') {
		const paper = layer.seed.includes('paper');
		const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
		gradient.addColorStop(0, paper ? '#17252a' : '#174d4c');
		gradient.addColorStop(0.52, paper ? '#24363a' : '#397c65');
		gradient.addColorStop(1, paper ? '#11191c' : '#d3a552');
		context.fillStyle = gradient;
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.globalAlpha = paper ? 0.12 : 0.48;
		context.strokeStyle = paper ? '#f3ead3' : '#d9f1d0';
		context.lineWidth = Math.max(1, canvas.width / 180);
		const lines = new Path2D();
		for (let offset = -canvas.height; offset < canvas.width + canvas.height; offset += 34) {
			lines.moveTo(offset, 0);
			lines.lineTo(offset + canvas.height, canvas.height);
		}
		context.stroke(lines);
		context.globalAlpha = 1;
		if (!paper) {
			context.fillStyle = '#f4d989';
			context.beginPath();
			context.arc(canvas.width * 0.52, canvas.height * 0.48, Math.min(canvas.width, canvas.height) * 0.28, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = '#143938';
			context.beginPath();
			context.arc(canvas.width * 0.52, canvas.height * 0.48, Math.min(canvas.width, canvas.height) * 0.2, 0, Math.PI * 2);
			context.fill();
		}
	} else if (layer.kind === 'text') {
		context.fillStyle = layer.color;
		context.font = `${layer.fontWeight} ${Math.min(layer.fontSize, canvas.height * 0.78)}px "${layer.fontFamily}", sans-serif`;
		context.textBaseline = 'middle';
		context.textAlign = layer.alignment === 'center' ?
			'center' :
			(layer.alignment === 'right' || layer.alignment === 'justified' ? 'right' : 'left');
		const x = context.textAlign === 'center' ? canvas.width / 2 : canvas.width - 4;
		context.fillText(layer.content, context.textAlign === 'left' ? 4 : x, canvas.height / 2, canvas.width - 8);
	} else {
		context.fillStyle = layer.fill;
		context.strokeStyle = layer.stroke;
		context.lineWidth = Math.max(2, Math.min(canvas.width, canvas.height) * 0.06);
		drawShape(context, layer, canvas, context.lineWidth / 2);
	}
	context.filter = 'none';
	return canvas;
}

function rasterKey(layer: RasterLayer): string {
	switch (layer.kind) {
		case 'image': {
			return JSON.stringify([layer.kind, layer.assetId, layer.seed, layer.bounds, layer.adjustments]);
		}
		case 'text': {
			return JSON.stringify([
				layer.kind, layer.content, layer.fontFamily, layer.color, layer.fontSize, layer.fontWeight,
				layer.alignment, layer.letterSpacing, layer.lineHeight, layer.wrapping, layer.bounds, layer.adjustments
			]);
		}
		case 'shape': {
			return JSON.stringify([layer.kind, layer.form, layer.fill, layer.stroke, layer.bounds, layer.adjustments]);
		}
		default: {
			throw new Error('Unsupported raster layer');
		}
	}
}

function rotatedDraw(
	context: CanvasRenderingContext2D,
	source: HTMLCanvasElement,
	sourceBounds: LayerBounds,
	sourceRotation: number,
	targetBounds: LayerBounds,
	targetRotation: number
): void {
	const sourceCenterX = sourceBounds.x + sourceBounds.width / 2;
	const sourceCenterY = sourceBounds.y + sourceBounds.height / 2;
	const targetCenterX = targetBounds.x + targetBounds.width / 2;
	const targetCenterY = targetBounds.y + targetBounds.height / 2;
	context.save();
	context.translate(targetBounds.width / 2, targetBounds.height / 2);
	context.rotate(-targetRotation * Math.PI / 180);
	context.translate(sourceCenterX - targetCenterX, sourceCenterY - targetCenterY);
	context.rotate(sourceRotation * Math.PI / 180);
	context.translate(-sourceBounds.width / 2, -sourceBounds.height / 2);
	context.drawImage(source, 0, 0, sourceBounds.width, sourceBounds.height);
	context.restore();
}

export class EditorAssetRegistry {
	private readonly assets = new Map<string, { kind: AssetKind; canvas: HTMLCanvasElement }>();
	private readonly revisions = new Map<string, number>();
	private readonly sourceCache = new Map<string, { key: string; canvas: HTMLCanvasElement }>();
	private readonly thumbnailCache = new Map<string, { key: string; dataUrl: string }>();
	private readonly clipCache = new Map<string, { key: string; canvas: HTMLCanvasElement }>();

	sourceFor(layer: RasterLayer): HTMLCanvasElement {
		const key = rasterKey(layer);
		const cached = this.sourceCache.get(layer.id);
		if (cached?.key === key) {
			return cached.canvas;
		}
		const rendered = layer.kind === 'image' && layer.assetId ? this.imageSource(layer) : renderGeneratedSource(layer);
		const canvas = cached && cached.canvas.width === rendered.width && cached.canvas.height === rendered.height ?
			cached.canvas :
			rendered;
		if (canvas !== rendered) {
			const context = contextFor(canvas);
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(rendered, 0, 0);
		}
		this.sourceCache.set(layer.id, { key, canvas });
		return canvas;
	}

	compositeFor(id: string, key: string, width: number, height: number, render: (canvas: HTMLCanvasElement) => void): HTMLCanvasElement {
		const cached = this.sourceCache.get(id);
		if (cached?.key === key) {
			return cached.canvas;
		}
		const canvas = cached && cached.canvas.width === width && cached.canvas.height === height ?
			cached.canvas :
			canvasFor(width, height);
		render(canvas);
		this.sourceCache.set(id, { key, canvas });
		return canvas;
	}

	maskFor(layer: RasterLayer): HTMLCanvasElement | undefined {
		return layer.maskEnabled && layer.maskAssetId ? this.assets.get(layer.maskAssetId)?.canvas : undefined;
	}

	thumbnailFor(layer: RasterLayer): string {
		const key = rasterKey(layer);
		const cached = this.thumbnailCache.get(layer.id);
		if (cached?.key === key) {
			return cached.dataUrl;
		}
		const source = this.sourceFor(layer);
		const canvas = canvasFor(36, 36);
		const context = contextFor(canvas);
		const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
		const width = source.width * scale;
		const height = source.height * scale;
		context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
		const dataUrl = canvas.toDataURL('image/png');
		this.thumbnailCache.set(layer.id, { key, dataUrl });
		return dataUrl;
	}

	combinedMaskFor(layer: RasterLayer, clipBase?: RasterLayer): HTMLCanvasElement | undefined {
		const ownMask = this.maskFor(layer);
		const clipMask = clipBase ? this.clipMaskFor(layer, clipBase) : undefined;
		if (!ownMask) {
			return clipMask;
		}
		if (!clipMask) {
			return ownMask;
		}
		const canvas = canvasFor(layer.bounds.width, layer.bounds.height);
		const context = contextFor(canvas);
		context.drawImage(ownMask, 0, 0, canvas.width, canvas.height);
		context.globalCompositeOperation = 'destination-in';
		context.drawImage(clipMask, 0, 0, canvas.width, canvas.height);
		return canvas;
	}

	createMask(layer: RasterLayer): string {
		if (this.assets.size >= MAX_ASSETS) {
			throw new Error(`Editor asset limit reached: ${MAX_ASSETS}`);
		}
		const id = assetId('mask');
		const canvas = canvasFor(layer.bounds.width, layer.bounds.height);
		const context = contextFor(canvas);
		context.fillStyle = '#fff';
		context.fillRect(0, 0, canvas.width, canvas.height);
		this.assets.set(id, { kind: 'mask', canvas });
		this.revisions.set(id, 0);
		return id;
	}

	registerCanvas(kind: AssetKind, source: HTMLCanvasElement): string {
		if (this.assets.size >= MAX_ASSETS) {
			throw new Error(`Editor asset limit reached: ${MAX_ASSETS}`);
		}
		const id = assetId(kind);
		const canvas = canvasFor(source.width, source.height);
		contextFor(canvas).drawImage(source, 0, 0);
		this.assets.set(id, { kind, canvas });
		this.revisions.set(id, 0);
		return id;
	}

	duplicateAsset(id: string): string {
		const asset = this.assets.get(id);
		if (!asset) {
			throw new Error(`Unknown editor asset: ${id}`);
		}
		return this.registerCanvas(asset.kind, asset.canvas);
	}

	removeAsset(id: string): void {
		this.assets.delete(id);
		this.revisions.delete(id);
		this.sourceCache.clear();
		this.thumbnailCache.clear();
		this.clipCache.clear();
	}

	collectGarbage(referencedIds: Iterable<string>): ReadonlyArray<string> {
		const referenced = new Set(referencedIds);
		const released: Array<string> = [];
		for (const id of this.assets.keys()) {
			if (referenced.has(id)) {
				continue;
			}
			this.assets.delete(id);
			this.revisions.delete(id);
			released.push(id);
		}
		if (released.length > 0) {
			this.sourceCache.clear();
			this.thumbnailCache.clear();
			this.clipCache.clear();
		}
		return released;
	}

	paintMask(id: string, x: number, y: number, radius: number, erase: boolean): void {
		const asset = this.assets.get(id);
		if (!asset || asset.kind !== 'mask') {
			throw new Error(`Unknown editor mask asset: ${id}`);
		}
		const context = contextFor(asset.canvas);
		context.save();
		context.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
		context.fillStyle = '#fff';
		context.beginPath();
		context.arc(x, y, Math.max(1, radius), 0, Math.PI * 2);
		context.fill();
		context.restore();
		this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
		this.clipCache.clear();
	}

	snapshotMask(id: string): EditorMaskSnapshot {
		const asset = this.assets.get(id);
		if (!asset || asset.kind !== 'mask') {
			throw new Error(`Unknown editor mask asset: ${id}`);
		}
		return {
			id,
			width: asset.canvas.width,
			height: asset.canvas.height,
			bytes: new Uint8ClampedArray(
				contextFor(asset.canvas).getImageData(0, 0, asset.canvas.width, asset.canvas.height).data
			)
		};
	}

	restoreMask(snapshot: EditorMaskSnapshot): void {
		const asset = this.assets.get(snapshot.id);
		if (!asset || asset.kind !== 'mask') {
			throw new Error(`Unknown editor mask asset: ${snapshot.id}`);
		}
		if (
			asset.canvas.width !== snapshot.width ||
			asset.canvas.height !== snapshot.height ||
			snapshot.bytes.length !== snapshot.width * snapshot.height * 4
		) {
			throw new Error(`Invalid editor mask snapshot: ${snapshot.id}`);
		}
		const context = contextFor(asset.canvas);
		const imageData = context.createImageData(snapshot.width, snapshot.height);
		imageData.data.set(snapshot.bytes);
		context.putImageData(imageData, 0, 0);
		this.revisions.set(snapshot.id, (this.revisions.get(snapshot.id) ?? 0) + 1);
		this.clipCache.clear();
	}

	async importImage(file: File): Promise<{ id: string; width: number; height: number }> {
		if (this.assets.size >= MAX_ASSETS) {
			throw new Error(`Editor asset limit reached: ${MAX_ASSETS}`);
		}
		if (!file.type.startsWith('image/')) {
			throw new Error(`Unsupported image type: ${file.type || 'unknown'}`);
		}
		if (file.size > MAX_IMAGE_BYTES) {
			throw new Error(`Image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MB import budget`);
		}
		const dataUrl = await readFileAsDataUrl(file);
		const image = await imageFromDataUrl(dataUrl);
		const canvas = canvasFor(image.naturalWidth, image.naturalHeight);
		contextFor(canvas).drawImage(image, 0, 0);
		const id = assetId('image');
		this.assets.set(id, { kind: 'image', canvas });
		this.revisions.set(id, 0);
		return { id, width: canvas.width, height: canvas.height };
	}

	serialize(): SerializedEditorAssets {
		return Object.fromEntries(
			[...this.assets].map(([id, asset]) => [id, { kind: asset.kind, dataUrl: asset.canvas.toDataURL('image/png') }])
		);
	}

	async restore(serialized: SerializedEditorAssets): Promise<void> {
		const entries = Object.entries(serialized);
		if (entries.length > MAX_ASSETS) {
			throw new EditorArchiveBudgetError(`Editor archive exceeds ${MAX_ASSETS} asset limit`);
		}
		const bytes = entries.reduce((sum, [, asset]) => sum + asset.dataUrl.length, 0);
		if (bytes > MAX_SERIALIZED_BYTES) {
			throw new EditorArchiveBudgetError(`Editor archive exceeds ${MAX_SERIALIZED_BYTES / 1024 / 1024} MB asset budget`);
		}
		const restored = new Map<string, { kind: AssetKind; canvas: HTMLCanvasElement }>();
		for (const [id, asset] of entries) {
			if (!id || (asset.kind !== 'image' && asset.kind !== 'mask') || !asset.dataUrl.startsWith('data:image/')) {
				throw new Error(`Invalid editor asset: ${id || '(missing id)'}`);
			}
			const image = await imageFromDataUrl(asset.dataUrl);
			const canvas = canvasFor(image.naturalWidth, image.naturalHeight);
			contextFor(canvas).drawImage(image, 0, 0);
			restored.set(id, { kind: asset.kind, canvas });
		}
		this.assets.clear();
		this.revisions.clear();
		for (const [id, asset] of restored) {
			this.assets.set(id, asset);
			this.revisions.set(id, 0);
		}
		this.sourceCache.clear();
		this.thumbnailCache.clear();
		this.clipCache.clear();
	}

	private imageSource(layer: ImageLayer): HTMLCanvasElement {
		const asset = layer.assetId ? this.assets.get(layer.assetId) : undefined;
		if (!asset || asset.kind !== 'image') {
			throw new Error(`Missing editor image asset: ${layer.assetId ?? '(none)'}`);
		}
		const canvas = canvasFor(layer.bounds.width, layer.bounds.height);
		const context = contextFor(canvas);
		const { brightness, contrast, saturation, blur } = layer.adjustments;
		context.filter = `brightness(${Math.max(0, 1 + brightness)}) contrast(${Math.max(0, 1 + contrast)}) saturate(${Math.max(0, 1 + saturation)}) blur(${blur}px)`;
		context.drawImage(asset.canvas, 0, 0, canvas.width, canvas.height);
		context.filter = 'none';
		return canvas;
	}

	private clipMaskFor(layer: RasterLayer, base: RasterLayer): HTMLCanvasElement {
		const baseMask = this.maskFor(base);
		const key = JSON.stringify([
			rasterKey(layer),
			layer.rotation,
			rasterKey(base),
			base.rotation,
			base.maskEnabled,
			base.maskAssetId,
			base.maskAssetId ? this.revisions.get(base.maskAssetId) ?? 0 : 0
		]);
		const cached = this.clipCache.get(layer.id);
		if (cached?.key === key) {
			return cached.canvas;
		}
		let baseSource = this.sourceFor(base);
		if (baseMask) {
			const masked = canvasFor(base.bounds.width, base.bounds.height);
			const maskedContext = contextFor(masked);
			maskedContext.drawImage(baseSource, 0, 0, masked.width, masked.height);
			maskedContext.globalCompositeOperation = 'destination-in';
			maskedContext.drawImage(baseMask, 0, 0, masked.width, masked.height);
			baseSource = masked;
		}
		const canvas = cached && cached.canvas.width === Math.round(layer.bounds.width) && cached.canvas.height === Math.round(layer.bounds.height) ?
			cached.canvas :
			canvasFor(layer.bounds.width, layer.bounds.height);
		const context = contextFor(canvas);
		context.clearRect(0, 0, canvas.width, canvas.height);
		rotatedDraw(context, baseSource, base.bounds, base.rotation, layer.bounds, layer.rotation);
		this.clipCache.set(layer.id, { key, canvas });
		return canvas;
	}
}
