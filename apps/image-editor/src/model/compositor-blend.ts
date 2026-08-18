export type CompositeBlendMode = 'normal' | 'multiply' | 'screen';

export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

function blendChannel(source: number, backdrop: number, mode: CompositeBlendMode): number {
	switch (mode) {
		case 'multiply': {
			return source * backdrop;
		}
		case 'screen': {
			return source + backdrop - source * backdrop;
		}
		default: {
			return source;
		}
	}
}

export function compositePixel(source: Rgba, backdrop: Rgba, opacity: number, mask: number, mode: CompositeBlendMode): Rgba {
	const sourceAlpha = source.a * opacity * mask;
	const backdropAlpha = backdrop.a;
	const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
	if (outputAlpha === 0) {
		return { r: 0, g: 0, b: 0, a: 0 };
	}

	const channel = (sourceChannel: number, backdropChannel: number): number => {
		const blended = blendChannel(sourceChannel, backdropChannel, mode);
		const color =
			(1 - backdropAlpha) * sourceAlpha * sourceChannel +
			(1 - sourceAlpha) * backdropAlpha * backdropChannel +
			sourceAlpha * backdropAlpha * blended;
		return color / outputAlpha;
	};

	return {
		r: channel(source.r, backdrop.r),
		g: channel(source.g, backdrop.g),
		b: channel(source.b, backdrop.b),
		a: outputAlpha
	};
}
export interface CompositePixelLayer {
	color: Rgba;
	opacity?: number;
	mask?: number;
	mode?: CompositeBlendMode;
}

export interface CompositeRgba8Layer {
	pixels: Uint8Array | Uint8ClampedArray;
	opacity?: number;
	mask?: Uint8Array | Uint8ClampedArray;
	mode?: CompositeBlendMode;
}

const clampUnit = (value: number): number => Math.max(0, Math.min(value, 1));

export function srgbToLinear(value: number): number {
	const channel = clampUnit(value);
	return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(value: number): number {
	const channel = clampUnit(value);
	return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

export function compositeLayers(layers: ReadonlyArray<CompositePixelLayer>): Rgba {
	let backdrop: Rgba = { r: 0, g: 0, b: 0, a: 0 };
	for (const layer of layers) {
		backdrop = compositePixel(
			layer.color,
			backdrop,
			clampUnit(layer.opacity ?? 1),
			clampUnit(layer.mask ?? 1),
			layer.mode ?? 'normal'
		);
	}
	return backdrop;
}

function quantizeLinearRgba8(color: Rgba): Rgba {
	return {
		r: Math.round(clampUnit(color.r) * 255) / 255,
		g: Math.round(clampUnit(color.g) * 255) / 255,
		b: Math.round(clampUnit(color.b) * 255) / 255,
		a: Math.round(clampUnit(color.a) * 255) / 255
	};
}

export function compositeRgba8(
	width: number,
	height: number,
	layers: ReadonlyArray<CompositeRgba8Layer>
): Uint8ClampedArray {
	const pixelCount = width * height;
	for (const layer of layers) {
		if (layer.pixels.length !== pixelCount * 4 || (layer.mask && layer.mask.length !== pixelCount)) {
			throw new Error('Layer pixel or mask length does not match compositor dimensions');
		}
	}

	const output = new Uint8ClampedArray(pixelCount * 4);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const offset = pixel * 4;
		let result: Rgba = { r: 0, g: 0, b: 0, a: 0 };
		for (const layer of layers) {
			result = quantizeLinearRgba8(compositePixel(
				{
					r: srgbToLinear(layer.pixels[offset] / 255),
					g: srgbToLinear(layer.pixels[offset + 1] / 255),
					b: srgbToLinear(layer.pixels[offset + 2] / 255),
					a: layer.pixels[offset + 3] / 255
				},
				result,
				clampUnit(layer.opacity ?? 1),
				clampUnit(layer.mask?.[pixel] === undefined ? 1 : layer.mask[pixel] / 255),
				layer.mode ?? 'normal'
			));
		}
		output[offset] = Math.round(linearToSrgb(result.r) * 255);
		output[offset + 1] = Math.round(linearToSrgb(result.g) * 255);
		output[offset + 2] = Math.round(linearToSrgb(result.b) * 255);
		output[offset + 3] = Math.round(clampUnit(result.a) * 255);
	}
	return output;
}
