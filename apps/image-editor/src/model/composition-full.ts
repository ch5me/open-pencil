import {
	compositePixel,
	linearToSrgb,
	srgbToLinear,
	type CompositeBlendMode,
	type Rgba
} from './compositor-blend';

export const COMPOSITION_FULL_VERSION = 'composition-full-v1';

export type CompositionCapabilityCode =
  | 'E_GROUP_MASK_UNSUPPORTED' |
  'E_ADJUSTMENT_MASK_UNSUPPORTED' |
  'E_CLIPPED_GROUP_UNSUPPORTED' |
  'E_RGBA16F_UNSUPPORTED' |
  'E_SKIA_UNSUPPORTED';

export class CompositionCapabilityError extends Error {
	readonly code: CompositionCapabilityCode;

	constructor(code: CompositionCapabilityCode, message: string) {
		super(`${code}: ${message}`);
		this.name = 'CompositionCapabilityError';
		this.code = code;
	}
}

export interface Rgba8Raster {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array | Uint8ClampedArray;
	readonly mask?: Uint8Array | Uint8ClampedArray;
}

export interface CompositionAdjustments {
	readonly brightness?: number;
	readonly contrast?: number;
	readonly saturation?: number;
	readonly blur?: number;
}

export interface CompositionLayer {
	readonly id: string;
	readonly kind: 'raster' | 'group' | 'section' | 'adjustment';
	readonly visible?: boolean;
	readonly opacity?: number;
	readonly blendMode?: CompositeBlendMode;
	readonly raster?: Rgba8Raster;
	readonly bounds?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
	readonly rotation?: number;
	readonly clipped?: boolean;
	readonly children?: ReadonlyArray<CompositionLayer>;
	readonly adjustments?: CompositionAdjustments;
	readonly mask?: Rgba8Raster;
}

export interface CompositionFrame {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8ClampedArray;
}

export interface CompositionInput {
	readonly width: number;
	readonly height: number;
	readonly layers: ReadonlyArray<CompositionLayer>;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const finite = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;

function validateRaster(raster: Rgba8Raster, label: string): void {
	if (!Number.isSafeInteger(raster.width) || !Number.isSafeInteger(raster.height) || raster.width < 1 || raster.height < 1) {
		throw new TypeError(`${label} dimensions must be positive whole pixels`);
	}
	if (raster.pixels.length !== raster.width * raster.height * 4) {
		throw new Error(`${label} pixel length does not match dimensions`);
	}
	if (raster.mask && raster.mask.length !== raster.width * raster.height) {
		throw new Error(`${label} mask length does not match dimensions`);
	}
}

function validateInput(input: CompositionInput): void {
	if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width < 1 || input.height < 1) {
		throw new TypeError(`Invalid composition dimensions: ${input.width}x${input.height}`);
	}
	const ids = new Set<string>();
	const visit = (layer: CompositionLayer): void => {
		if (!layer.id || ids.has(layer.id)) {
			throw new Error(`Duplicate composition layer ID: ${layer.id}`);
		}
		ids.add(layer.id);
		if (layer.kind === 'raster') {
			if (!layer.raster) {
				throw new Error(`Raster layer has no pixels: ${layer.id}`);
			}
			validateRaster(layer.raster, `Raster layer ${layer.id}`);
			if (layer.mask) {
				validateRaster(layer.mask, `Mask ${layer.id}`);
			}
		}
		if (layer.kind === 'group' && layer.mask) {
			throw new CompositionCapabilityError('E_GROUP_MASK_UNSUPPORTED', `Group ${layer.id} has a mask`);
		}
		if (layer.kind === 'adjustment' && layer.mask) {
			throw new CompositionCapabilityError('E_ADJUSTMENT_MASK_UNSUPPORTED', `Adjustment ${layer.id} has a mask`);
		}
		if (layer.kind === 'group' && layer.clipped) {
			throw new CompositionCapabilityError('E_CLIPPED_GROUP_UNSUPPORTED', `Group ${layer.id} is clipped`);
		}
		const children = layer.children ?? [];
		for (const child of children) {
			visit(child);
		}
	};
	for (const layer of input.layers) {
		visit(layer);
	}
}

function blank(width: number, height: number): Uint8ClampedArray {
	return new Uint8ClampedArray(width * height * 4);
}

function sample(raster: Rgba8Raster, x: number, y: number): Rgba {
	const sx = Math.max(0, Math.min(raster.width - 1, Math.floor(x)));
	const sy = Math.max(0, Math.min(raster.height - 1, Math.floor(y)));
	const offset = (sy * raster.width + sx) * 4;
	return {
		r: srgbToLinear(raster.pixels[offset] / 255),
		g: srgbToLinear(raster.pixels[offset + 1] / 255),
		b: srgbToLinear(raster.pixels[offset + 2] / 255),
		a: raster.pixels[offset + 3] / 255
	};
}

function maskValue(raster: Rgba8Raster | undefined, x: number, y: number): number {
	if (!raster) {
		return 1;
	}
	const sx = Math.max(0, Math.min(raster.width - 1, Math.floor(x)));
	const sy = Math.max(0, Math.min(raster.height - 1, Math.floor(y)));
	return (raster.mask ? raster.mask[sy * raster.width + sx] : raster.pixels[(sy * raster.width + sx) * 4 + 3]) / 255;
}

function transformSample(
	raster: Rgba8Raster,
	bounds: NonNullable<CompositionLayer['bounds']>,
	rotation: number,
	x: number,
	y: number
): { color: Rgba; mask: number; inside: boolean } {
	const radians = -rotation * Math.PI / 180;
	const centerX = bounds.x + bounds.width / 2;
	const centerY = bounds.y + bounds.height / 2;
	const dx = x - centerX;
	const dy = y - centerY;
	const localX = (dx * Math.cos(radians) - dy * Math.sin(radians)) / bounds.width + 0.5;
	const localY = (dx * Math.sin(radians) + dy * Math.cos(radians)) / bounds.height + 0.5;
	const inside = localX >= 0 && localX <= 1 && localY >= 0 && localY <= 1;
	const sourceX = localX * raster.width;
	const sourceY = localY * raster.height;
	return {
		color: sample(raster, sourceX, sourceY),
		mask: maskValue(raster, sourceX, sourceY),
		inside
	};
}

function adjust(color: Rgba, adjustments: CompositionAdjustments): Rgba {
	const brightness = finite(adjustments.brightness ?? 0, 0);
	const contrast = finite(adjustments.contrast ?? 0, 0);
	const saturation = finite(adjustments.saturation ?? 0, 0);
	const red = clamp(color.r + brightness);
	const green = clamp(color.g + brightness);
	const blue = clamp(color.b + brightness);
	const contrasted = {
		r: clamp((red - 0.5) * (1 + contrast) + 0.5),
		g: clamp((green - 0.5) * (1 + contrast) + 0.5),
		b: clamp((blue - 0.5) * (1 + contrast) + 0.5)
	};
	const luminance = contrasted.r * 0.2126 + contrasted.g * 0.7152 + contrasted.b * 0.0722;
	return {
		r: clamp(luminance + (contrasted.r - luminance) * (1 + saturation)),
		g: clamp(luminance + (contrasted.g - luminance) * (1 + saturation)),
		b: clamp(luminance + (contrasted.b - luminance) * (1 + saturation)),
		a: color.a
	};
}

function compositeRaster(
	backdrop: Uint8ClampedArray,
	width: number,
	height: number,
	layer: CompositionLayer,
	clip?: Uint8ClampedArray
): void {
	if (!layer.raster) {
		throw new Error(`Raster layer has no pixels: ${layer.id}`);
	}
	const bounds = layer.bounds ?? { x: 0, y: 0, width, height };
	const opacity = clamp(layer.opacity ?? 1);
	const mode = layer.blendMode ?? 'normal';
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const transformed = transformSample(layer.raster, bounds, layer.rotation ?? 0, x + 0.5, y + 0.5);
			if (transformed.inside) {
				const offset = (y * width + x) * 4;
				const backdropColor: Rgba = {
					r: srgbToLinear(backdrop[offset] / 255),
					g: srgbToLinear(backdrop[offset + 1] / 255),
					b: srgbToLinear(backdrop[offset + 2] / 255),
					a: backdrop[offset + 3] / 255
				};
				const clipAlpha = clip ? clip[offset + 3] / 255 : 1;
				const result = compositePixel(
					transformed.color,
					backdropColor,
					opacity,
					transformed.mask * clipAlpha,
					mode
				);
				backdrop[offset] = Math.round(linearToSrgb(result.r) * 255);
				backdrop[offset + 1] = Math.round(linearToSrgb(result.g) * 255);
				backdrop[offset + 2] = Math.round(linearToSrgb(result.b) * 255);
				backdrop[offset + 3] = Math.round(clamp(result.a) * 255);
			}
		}
	}
}

function compositeLayers(
	width: number,
	height: number,
	layers: ReadonlyArray<CompositionLayer>
): Uint8ClampedArray {
	const output = blank(width, height);
	let clippingBase: Uint8ClampedArray | undefined;
	for (const layer of layers) {
		if (layer.visible === false || (layer.opacity ?? 1) === 0) {
			continue;
		}
		if (layer.kind === 'raster') {
			compositeRaster(output, width, height, layer, layer.clipped ? clippingBase : undefined);
			if (!layer.clipped) {
				clippingBase = output.slice();
			}
		} else if (layer.kind === 'group' || layer.kind === 'section') {
			const group = compositeLayers(width, height, layer.children ?? []);
			const groupLayer: CompositionLayer = {
				...layer,
				kind: 'raster',
				raster: { width, height, pixels: group },
				bounds: layer.bounds ?? { x: 0, y: 0, width, height }
			};
			compositeRaster(output, width, height, groupLayer);
		} else {
			const adjustments = layer.adjustments ?? {};
			for (let index = 0; index < output.length; index += 4) {
				const adjusted = adjust({
					r: srgbToLinear(output[index] / 255),
					g: srgbToLinear(output[index + 1] / 255),
					b: srgbToLinear(output[index + 2] / 255),
					a: output[index + 3] / 255
				}, adjustments);
				output[index] = Math.round(linearToSrgb(adjusted.r) * 255);
				output[index + 1] = Math.round(linearToSrgb(adjusted.g) * 255);
				output[index + 2] = Math.round(linearToSrgb(adjusted.b) * 255);
			}
		}
	}
	return output;
}

export function composeRgba8(input: CompositionInput): CompositionFrame {
	validateInput(input);
	return {
		width: input.width,
		height: input.height,
		pixels: compositeLayers(input.width, input.height, input.layers)
	};
}

export function composeRgba16f(): never {
	throw new CompositionCapabilityError('E_RGBA16F_UNSUPPORTED', 'RGBA16F composition is not available in the OpenPencil image-editor app');
}

export function composeWithSkia(): never {
	throw new CompositionCapabilityError('E_SKIA_UNSUPPORTED', 'Skia composition is not available in the OpenPencil image-editor app');
}
