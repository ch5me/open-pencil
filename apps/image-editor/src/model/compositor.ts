import {
	compositeRgba8,
	type CompositeRgba8Layer
} from './compositor-blend';
export type { CompositeBlendMode } from './compositor-blend';

export const COMPOSITOR_PACKAGE_VERSION = 'compositor-v1';

export interface CompositorLayer extends CompositeRgba8Layer {
	id: string;
}

export interface CompositorFrame {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8ClampedArray;
}

export interface FrameworkNeutralCompositor {
	readonly width: number;
	readonly height: number;
	setLayers(layers: ReadonlyArray<CompositorLayer>): void;
	getLayers(): ReadonlyArray<CompositorLayer>;
	render(): CompositorFrame;
}

export function createCompositor(
	width: number,
	height: number,
	layers: ReadonlyArray<CompositorLayer> = []
): FrameworkNeutralCompositor {
	assertDimensions(width, height);
	let currentLayers = copyLayers(layers, width, height);

	return {
		width,
		height,
		setLayers(nextLayers) {
			currentLayers = copyLayers(nextLayers, width, height);
		},
		getLayers() {
			return copyLayers(currentLayers, width, height);
		},
		render() {
			return {
				width,
				height,
				pixels: compositeRgba8(width, height, currentLayers)
			};
		}
	};
}

function copyLayers(
	layers: ReadonlyArray<CompositorLayer>,
	width: number,
	height: number
): Array<CompositorLayer> {
	const ids = new Set<string>();
	return layers.map(layer => {
		if (!layer.id) {
			throw new Error('Compositor layer ID is required');
		}
		if (ids.has(layer.id)) {
			throw new Error(`Duplicate compositor layer ID: ${layer.id}`);
		}
		ids.add(layer.id);
		if (layer.pixels.length !== width * height * 4) {
			throw new Error(`Layer pixel length does not match compositor dimensions: ${layer.id}`);
		}
		if (layer.mask && layer.mask.length !== width * height) {
			throw new Error(`Layer mask length does not match compositor dimensions: ${layer.id}`);
		}
		return {
			...layer,
			pixels: new Uint8ClampedArray(layer.pixels),
			mask: layer.mask ? new Uint8ClampedArray(layer.mask) : undefined
		};
	});
}

function assertDimensions(width: number, height: number): void {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
		throw new TypeError(`Invalid compositor dimensions: ${width}x${height}`);
	}
}
