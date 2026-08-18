import {
	CanvasTexture,
	DataTexture,
	LinearFilter,
	MeshBasicNodeMaterial,
	NoBlending,
	NoColorSpace,
	NoToneMapping,
	QuadMesh,
	RenderTarget,
	RGBAFormat,
	SRGBColorSpace,
	UnsignedByteType,
	Vector2,
	WebGPUBackend,
	WebGPURenderer
} from 'three/webgpu';
import { blendScreen, luminance, max, mix, rotateUV, step, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { linearToSrgb, type CompositeBlendMode } from '../../model/compositor-blend';
import {
	type Compositor,
	type CompositorFailure,
	type CompositorLayer,
	type CompositorLayerPatch,
	type CompositorOptions,
	type CompositorTextureUploadSnapshot
} from './compositor-contract';
export type {
	CompositorFailure,
	CompositorLayer,
	CompositorLayerPatch
} from './compositor-contract';
export type { CompositeBlendMode } from '../../model/compositor-blend';

export const THREE_COMPOSITOR_RUNTIME_VERSION = 'three-compositor-v1';
export { COMPOSITOR_PACKAGE_VERSION } from './compositor-contract';
export type ThreeCompositorOptions = CompositorOptions;
interface LayerTextures {
	source: CanvasTexture;
	sourceRevision: number;
	mask?: CanvasTexture;
	maskRevision?: number;
}

export class ThreeCompositor implements Compositor {
	private readonly renderer: WebGPURenderer;
	readonly backend: 'webgpu' | 'webgl2';
	private readonly canvas: HTMLCanvasElement;
	private readonly onFailure?: (failure: CompositorFailure) => void;
	private readonly pixelRatio: number;
	private readonly targets: [RenderTarget, RenderTarget];
	private readonly layerTextures = new Map<string, LayerTextures>();
	private readonly reportedLossEvents = new WeakSet<object>();
	private readonly quad = new QuadMesh();
	private readonly whiteMask: DataTexture;
	private readonly backdropNode: ReturnType<typeof texture>;
	private readonly sourceNode: ReturnType<typeof texture>;
	private readonly maskNode: ReturnType<typeof texture>;
	private readonly opacityNode = uniform(1);
	private readonly blendModeNode = uniform(0);
	private readonly layerKindNode = uniform(0);
	private readonly hasMaskNode = uniform(0);
	private readonly brightnessNode = uniform(0);
	private readonly contrastNode = uniform(0);
	private readonly saturationNode = uniform(0);
	private readonly boundsOriginNode = uniform(new Vector2(0, 0));
	private readonly boundsSizeNode = uniform(new Vector2(1, 1));
	private readonly rotationNode = uniform(0);
	private readonly outputSizeNode = uniform(new Vector2(1, 1));
	private readonly compositeMaterial: MeshBasicNodeMaterial;
	private readonly screenMaterial: MeshBasicNodeMaterial;
	private layers: Array<CompositorLayer> = [];
	private width = 1;
	private height = 1;
	private targetWidth = 1;
	private targetHeight = 1;
	private finalTarget: RenderTarget;
	private destroyed = false;
	private terminalFailure?: CompositorFailure;
	private rendered = false;
	private sourceTextureUploads = 0;
	private maskTextureUploads = 0;

	private constructor(options: ThreeCompositorOptions, renderer: WebGPURenderer) {
		this.canvas = options.canvas;
		this.renderer = renderer;
		this.backend = renderer.backend instanceof WebGPUBackend ? 'webgpu' : 'webgl2';
		this.onFailure = options.onFailure;
		this.pixelRatio = this.validatePixelRatio(options.pixelRatio ?? Math.min(globalThis.devicePixelRatio ?? 1, 2));
		this.targets = [this.createTarget(), this.createTarget()];
		this.finalTarget = this.targets[0];
		this.whiteMask = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
		this.whiteMask.colorSpace = NoColorSpace;
		this.whiteMask.needsUpdate = true;
		this.backdropNode = texture(this.targets[0].texture);
		this.sourceNode = texture(this.whiteMask);
		this.maskNode = texture(this.whiteMask);
		this.compositeMaterial = this.createCompositeMaterial();
		this.screenMaterial = this.createScreenMaterial();
		this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
		this.renderer.onDeviceLost = info => this.failLoss(info.api === 'WebGL' ? 'context-lost' : 'device-lost', this.failureMessage(info.message, `Three.js ${info.api} device lost`), info.originalEvent);
		this.renderer.onError = message => this.fail('renderer-error', this.failureMessage(message, 'Three.js renderer error'), message);
		this.setLayers(options.layers ?? []);
		this.resize(options.canvas.width || 1, options.canvas.height || 1);
	}

	static async create(options: CompositorOptions): Promise<ThreeCompositor> {
		const renderer = new WebGPURenderer({ canvas: options.canvas, alpha: true, antialias: false, forceWebGL: options.forceWebGL ?? false, outputBufferType: UnsignedByteType });
		try {
			await renderer.init();
			renderer.outputColorSpace = SRGBColorSpace;
			renderer.toneMapping = NoToneMapping;
			renderer.setClearColor(0, 0);
			return new ThreeCompositor(options, renderer);
		} catch (error) {
			renderer.dispose();
			options.onFailure?.({ kind: 'renderer-error', message: 'Three.js renderer initialization failed', cause: error });
			throw error;
		}
	}

	setLayers(layers: Array<CompositorLayer>): void {
		this.assertUsable();
		this.validateLayers(layers);
		const nextIds = new Set(layers.map(layer => layer.id));
		for (const [id, owned] of this.layerTextures) {
			const next = layers.find(layer => layer.id === id);
			if (!nextIds.has(id) || next?.source !== owned.source.image || next.mask !== owned.mask?.image) {
				this.disposeLayerTextures(id);
			}
		}
		this.rendered = false;
		this.layers = layers.map(layer => this.copyLayer(layer));
	}

	updateLayer(id: string, patch: CompositorLayerPatch): void {
		this.assertUsable();
		const index = this.layers.findIndex(layer => layer.id === id);
		if (index === -1) {
			throw new Error(`Unknown compositor layer: ${id}`);
		}
		const previous = this.layers[index];
		const candidate = { ...previous, ...patch, id };
		this.validateLayer(candidate);
		const next = this.copyLayer(candidate);
		if (next.source !== previous.source || next.mask !== previous.mask) {
			this.disposeLayerTextures(id);
		}
		this.rendered = false;
		this.layers[index] = next;
	}

	reorderLayers(ids: Array<string>): void {
		this.assertUsable();
		if (ids.length !== this.layers.length || new Set(ids).size !== ids.length) {
			throw new Error('Layer reorder must contain every layer ID exactly once');
		}
		const byId = new Map(this.layers.map(layer => [layer.id, layer]));
		this.layers = ids.map(id => {
			const layer = byId.get(id);
			if (!layer) {
				throw new Error(`Unknown compositor layer in reorder: ${id}`);
			}
			return layer;
		});
		this.rendered = false;
	}

	getLayers(): Array<CompositorLayer> {
		return this.layers.map(layer => this.copyLayer(layer));
	}

	getTextureUploadSnapshot(): CompositorTextureUploadSnapshot {
		return {
			source: this.sourceTextureUploads,
			mask: this.maskTextureUploads,
			total: this.sourceTextureUploads + this.maskTextureUploads
		};
	}

	resize(width: number, height: number): void {
		this.assertUsable();
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
			throw new TypeError(`Invalid compositor size: ${width}x${height}`);
		}
		this.width = Math.round(width);
		this.height = Math.round(height);
		this.targetWidth = Math.max(1, Math.round(this.width * this.pixelRatio));
		this.targetHeight = Math.max(1, Math.round(this.height * this.pixelRatio));
		this.outputSizeNode.value.set(this.width, this.height);
		this.renderer.setPixelRatio(this.pixelRatio);
		this.renderer.setSize(this.width, this.height, false);
		for (const target of this.targets) {
			target.setSize(this.targetWidth, this.targetHeight);
		}
		this.rendered = false;
	}

	render(): void {
		this.assertUsable();
		try {
			this.rendered = false;
			let readIndex = 0;
			this.renderer.setRenderTarget(this.targets[readIndex]);
			this.renderer.clear(true, false, false);
			for (const layer of this.layers) {
				if (!layer.visible || layer.opacity === 0) {
					continue;
				}
				const writeIndex = readIndex === 0 ? 1 : 0;
				const textures = this.texturesFor(layer);
				const bounds = layer.bounds ?? { x: 0, y: 0, width: this.width, height: this.height };
				this.backdropNode.value = this.targets[readIndex].texture;
				this.sourceNode.value = textures.source;
				this.maskNode.value = textures.mask ?? this.whiteMask;
				this.opacityNode.value = layer.opacity;
				this.blendModeNode.value = this.blendModeValue(layer.blendMode);
				this.layerKindNode.value = layer.kind === 'adjustment' ? 1 : 0;
				this.hasMaskNode.value = textures.mask ? 1 : 0;
				this.brightnessNode.value = layer.adjustments?.brightness ?? 0;
				this.contrastNode.value = layer.adjustments?.contrast ?? 0;
				this.saturationNode.value = layer.adjustments?.saturation ?? 0;
				this.boundsOriginNode.value.set(bounds.x, bounds.y);
				this.boundsSizeNode.value.set(bounds.width, bounds.height);
				this.rotationNode.value = (layer.rotation ?? 0) * Math.PI / 180;
				this.renderer.setRenderTarget(this.targets[writeIndex]);
				this.renderer.clear(true, false, false);
				this.quad.material = this.compositeMaterial;
				this.quad.render(this.renderer);
				readIndex = writeIndex;
			}
			this.finalTarget = this.targets[readIndex];
			this.backdropNode.value = this.finalTarget.texture;
			this.renderer.setRenderTarget(null);
			this.quad.material = this.screenMaterial;
			this.quad.render(this.renderer);
			this.rendered = true;
		} catch (error) {
			this.fail('renderer-error', 'Three.js compositor render failed', error);
			throw error;
		}
	}

	async readPixels(): Promise<Uint8Array> {
		this.assertUsable();
		if (!this.rendered) {
			throw new Error('ThreeCompositor must render before readPixels');
		}
		try {
			const pixels = await this.renderer.readRenderTargetPixelsAsync(this.finalTarget, 0, 0, this.targetWidth, this.targetHeight);
			const bytes = pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
			const rowBytes = this.targetWidth * 4;
			const paddedRowBytes = Math.ceil(rowBytes / 256) * 256;
			const expectedBytes = bytes.length === rowBytes * this.targetHeight ? rowBytes * this.targetHeight : (this.targetHeight - 1) * paddedRowBytes + rowBytes;
			if (bytes.length !== expectedBytes) {
				throw new Error(`Unexpected compositor readback size: ${bytes.length}`);
			}
			const stride = bytes.length === rowBytes * this.targetHeight ? rowBytes : paddedRowBytes;
			const output = new Uint8Array(rowBytes * this.targetHeight);
			for (let row = 0; row < this.targetHeight; row += 1) {
				const sourceRow = this.backend === 'webgpu' ? this.targetHeight - row - 1 : row;
				for (let column = 0; column < this.targetWidth; column += 1) {
					const source = sourceRow * stride + column * 4;
					const destination = row * rowBytes + column * 4;
					for (let channel = 0; channel < 3; channel += 1) {
						output[destination + channel] = Math.round(linearToSrgb(bytes[source + channel] / 255) * 255);
					}
					output[destination + 3] = bytes[source + 3];
				}
			}
			return output;
		} catch (error) {
			this.fail('renderer-error', 'Three.js compositor readback failed', error);
			throw error;
		}
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
		this.renderer.onError = (): void => { /* Renderer disposed. */ };
		this.renderer.onDeviceLost = (): void => { /* Renderer disposed. */ };
		for (const id of this.layerTextures.keys()) {
			this.disposeLayerTextures(id);
		}
		this.compositeMaterial.dispose();
		this.screenMaterial.dispose();
		this.whiteMask.dispose();
		for (const target of this.targets) {
			target.dispose();
		}
		this.renderer.dispose();
	}

	private readonly handleContextLost = (event: Event): void => {
		event.preventDefault();
		this.failLoss('context-lost', 'Three.js WebGL context lost', event);
	};

	private createTarget(): RenderTarget {
		const target = new RenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false, format: RGBAFormat, type: UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter });
		target.texture.colorSpace = NoColorSpace;
		target.texture.generateMipmaps = false;
		return target;
	}

	private createCompositeMaterial(): MeshBasicNodeMaterial {
		const outputUv = uv();
		const boundsMin = this.boundsOriginNode.div(this.outputSizeNode);
		const boundsSpan = this.boundsSizeNode.div(this.outputSizeNode);
		const unrotatedUv = outputUv.sub(vec2(boundsMin.x, boundsMin.y.oneMinus().sub(boundsSpan.y))).div(boundsSpan);
		const localUv = rotateUV(unrotatedUv, this.rotationNode.negate());
		const inside = step(0, localUv.x).mul(step(localUv.x, 1)).mul(step(0, localUv.y)).mul(step(localUv.y, 1));
		const source = this.sourceNode.sample(localUv);
		const backdrop = this.backdropNode;
		const mask = mix(1, this.maskNode.sample(localUv).r, this.hasMaskNode);
		const sourceAlpha = source.a.mul(this.opacityNode).mul(mask).mul(inside);
		const backdropAlpha = backdrop.a;
		const outputAlpha = sourceAlpha.add(backdropAlpha.mul(sourceAlpha.oneMinus()));
		const blended = this.blendModeNode.equal(1).select(source.rgb.mul(backdrop.rgb), this.blendModeNode.equal(2).select(blendScreen(backdrop.rgb, source.rgb), source.rgb));
		const outputColor = source.rgb.mul(sourceAlpha).mul(backdropAlpha.oneMinus()).add(backdrop.rgb.mul(backdropAlpha).mul(sourceAlpha.oneMinus())).add(blended.mul(sourceAlpha).mul(backdropAlpha)).div(max(outputAlpha, 0.000001));
		const contrasted = backdrop.rgb.add(this.brightnessNode).sub(0.5).mul(this.contrastNode.add(1)).add(0.5);
		const adjusted = mix(vec3(luminance(contrasted)), contrasted, this.saturationNode.add(1)).clamp(0, 1);
		const adjustedColor = mix(backdrop.rgb, adjusted, this.opacityNode.mul(mask).mul(inside));
		const material = new MeshBasicNodeMaterial();
		material.colorNode = this.layerKindNode.equal(1).select(vec4(adjustedColor, backdropAlpha), vec4(outputColor, outputAlpha));
		material.blending = NoBlending;
		material.transparent = false;
		material.depthTest = false;
		material.depthWrite = false;
		return material;
	}

	private createScreenMaterial(): MeshBasicNodeMaterial {
		const screenUv = uv();
		const material = new MeshBasicNodeMaterial();
		material.colorNode = this.backdropNode.sample(vec2(screenUv.x, screenUv.y.oneMinus()));
		material.blending = NoBlending;
		material.transparent = false;
		material.depthTest = false;
		material.depthWrite = false;
		return material;
	}

	private texturesFor(layer: CompositorLayer): LayerTextures {
		const cached = this.layerTextures.get(layer.id);
		if (cached) {
			const sourceRevision = layer.sourceRevision ?? 0;
			if (cached.sourceRevision !== sourceRevision) {
				cached.source.needsUpdate = true;
				cached.sourceRevision = sourceRevision;
				this.sourceTextureUploads += 1;
			}
			const maskRevision = layer.maskRevision ?? 0;
			if (cached.mask && cached.maskRevision !== maskRevision) {
				cached.mask.needsUpdate = true;
				cached.maskRevision = maskRevision;
				this.maskTextureUploads += 1;
			}
			return cached;
		}
		const owned = {
			source: this.createCanvasTexture(layer.source, SRGBColorSpace),
			sourceRevision: layer.sourceRevision ?? 0,
			mask: layer.mask ? this.createCanvasTexture(layer.mask, NoColorSpace) : undefined,
			maskRevision: layer.mask ? (layer.maskRevision ?? 0) : undefined
		};
		this.sourceTextureUploads += 1;
		if (owned.mask) {
			this.maskTextureUploads += 1;
		}
		this.layerTextures.set(layer.id, owned);
		return owned;
	}

	private createCanvasTexture(canvas: HTMLCanvasElement, colorSpace: CanvasTexture['colorSpace']): CanvasTexture {
		const value = new CanvasTexture(canvas);
		value.colorSpace = colorSpace;
		value.generateMipmaps = false;
		value.minFilter = LinearFilter;
		value.magFilter = LinearFilter;
		return value;
	}

	private disposeLayerTextures(id: string): void {
		const owned = this.layerTextures.get(id);
		if (owned) {
			owned.source.dispose();
			owned.mask?.dispose();
			this.layerTextures.delete(id);
		}
	}

	private validateLayers(layers: Array<CompositorLayer>): void {
		const ids = new Set<string>();
		for (const layer of layers) {
			this.validateLayer(layer);
			if (ids.has(layer.id)) {
				throw new Error(`Duplicate compositor layer ID: ${layer.id}`);
			}
			ids.add(layer.id);
		}
	}

	private validateLayer(layer: CompositorLayer): void {
		if (!layer.id) {
			throw new Error('Compositor layer ID is required');
		}
		if (!Number.isFinite(layer.opacity)) {
			throw new TypeError(`Invalid opacity for compositor layer: ${layer.id}`);
		}
		if (!['normal', 'multiply', 'screen'].includes(layer.blendMode)) {
			throw new TypeError(`Invalid blend mode for compositor layer: ${layer.id}`);
		}
		if (layer.kind !== undefined && layer.kind !== 'content' && layer.kind !== 'adjustment') {
			throw new TypeError(`Invalid kind for compositor layer: ${layer.id}`);
		}
		if (layer.bounds) {
			const { x, y, width, height } = layer.bounds;
			if ([x, y, width, height].some(value => !Number.isFinite(value)) || width <= 0 || height <= 0) {
				throw new TypeError(`Invalid bounds for compositor layer: ${layer.id}`);
			}
		}
		if (layer.rotation !== undefined && !Number.isFinite(layer.rotation)) {
			throw new TypeError(`Invalid rotation for compositor layer: ${layer.id}`);
		}
		for (const [name, revision] of [['source', layer.sourceRevision], ['mask', layer.maskRevision]] as const) {
			if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) {
				throw new TypeError(`Invalid ${name} revision for compositor layer: ${layer.id}`);
			}
		}
		if (layer.adjustments && Object.values(layer.adjustments).some(value => !Number.isFinite(value))) {
			throw new TypeError(`Invalid adjustments for compositor layer: ${layer.id}`);
		}
	}

	private copyLayer(layer: CompositorLayer): CompositorLayer {
		return {
			...layer,
			opacity: Math.max(0, Math.min(layer.opacity, 1)),
			bounds: layer.bounds ? { ...layer.bounds } : undefined,
			rotation: layer.rotation ?? 0
		};
	}

	private validatePixelRatio(value: number): number {
		if (!Number.isFinite(value) || value <= 0) {
			throw new TypeError(`Invalid compositor pixel ratio: ${value}`);
		}
		return value;
	}

	private blendModeValue(mode: CompositeBlendMode): number {
		return mode === 'multiply' ? 1 : (mode === 'screen' ? 2 : 0);
	}

	private assertUsable(): void {
		if (this.destroyed) {
			throw new Error('ThreeCompositor has been destroyed');
		}
		if (this.terminalFailure) {
			throw new Error(`ThreeCompositor unavailable after ${this.terminalFailure.kind}: ${this.terminalFailure.message}`);
		}
	}

	private failureMessage(value: unknown, fallback: string): string {
		return typeof value === 'string' && value.length > 0 ? value : (value instanceof Error ? value.message : fallback);
	}

	private fail(kind: CompositorFailure['kind'], message: string, cause?: unknown): void {
		const failure = { kind, message, cause } satisfies CompositorFailure;
		this.terminalFailure ??= failure;
		this.onFailure?.(failure);
	}

	private failLoss(kind: 'device-lost' | 'context-lost', message: string, cause: unknown): void {
		if (cause && typeof cause === 'object') {
			if (this.reportedLossEvents.has(cause)) {
				return;
			}
			this.reportedLossEvents.add(cause);
		}
		const failure = { kind, message, cause } satisfies CompositorFailure;
		this.terminalFailure ??= failure;
		this.onFailure?.(failure);
	}
}
