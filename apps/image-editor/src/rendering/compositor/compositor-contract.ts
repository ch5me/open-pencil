import type { CompositeBlendMode } from '../../model/compositor-blend';

export const COMPOSITOR_PACKAGE_VERSION = 'compositor-package-v1';

export interface CompositorLayer {
	id: string;
	source: HTMLCanvasElement;
	sourceRevision?: number;
	kind?: 'content' | 'adjustment';
	opacity: number;
	blendMode: CompositeBlendMode;
	mask?: HTMLCanvasElement;
	maskRevision?: number;
	visible: boolean;
	bounds?: { x: number; y: number; width: number; height: number };
	rotation?: number;
	adjustments?: {
		brightness: number;
		contrast: number;
		saturation: number;
	};
}

export interface CompositorOptions {
	canvas: HTMLCanvasElement;
	layers?: Array<CompositorLayer>;
	forceWebGL?: boolean;
	pixelRatio?: number;
	onFailure?: (failure: CompositorFailure) => void;
}

export interface CompositorFailure {
	kind: 'device-lost' | 'context-lost' | 'renderer-error';
	message: string;
	cause?: unknown;
}

export type CompositorLayerPatch = Omit<Partial<CompositorLayer>, 'id'>;

export interface CompositorTextureUploadSnapshot {
	readonly source: number;
	readonly mask: number;
	readonly total: number;
}

export interface Compositor {
	readonly backend: 'webgpu' | 'webgl2';
	setLayers(layers: Array<CompositorLayer>): void;
	updateLayer(id: string, patch: CompositorLayerPatch): void;
	reorderLayers(ids: Array<string>): void;
	getLayers(): Array<CompositorLayer>;
	getTextureUploadSnapshot(): CompositorTextureUploadSnapshot;
	resize(width: number, height: number): void;
	render(): void;
	readPixels(): Promise<Uint8Array>;
	destroy(): void;
}

export interface CompositorModule {
	readonly COMPOSITOR_PACKAGE_VERSION: string;
	readonly THREE_COMPOSITOR_RUNTIME_VERSION?: string;
	readonly ThreeCompositor: {
		readonly create: (options: CompositorOptions) => Promise<Compositor>;
	};
}

export type CompositorImporter = () => Promise<CompositorModule>;
