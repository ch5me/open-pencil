import { compositeLayers, compositePixel, compositeRgba8, linearToSrgb, srgbToLinear } from './compositor-blend';

describe('compositePixel', () => {
	const source = { r: 0.8, g: 0.4, b: 0.2, a: 0.75 };
	const backdrop = { r: 0.25, g: 0.5, b: 0.9, a: 1 };

	it('applies source-over alpha with a mask', () => {
		const result = compositePixel(source, backdrop, 0.8, 0.5, 'normal');
		expect(result.r).toBeCloseTo(0.415);
		expect(result.g).toBeCloseTo(0.47);
		expect(result.b).toBeCloseTo(0.69);
		expect(result.a).toBe(1);
	});

	it('supports multiply and screen using the same source-over equation', () => {
		const multiply = compositePixel(source, backdrop, 1, 1, 'multiply');
		expect(multiply.r).toBeCloseTo(0.2125);
		expect(multiply.g).toBeCloseTo(0.275);
		expect(multiply.b).toBeCloseTo(0.36);
		expect(multiply.a).toBe(1);

		const screen = compositePixel(source, backdrop, 1, 1, 'screen');
		expect(screen.r).toBeCloseTo(0.7);
		expect(screen.g).toBeCloseTo(0.65);
		expect(screen.b).toBeCloseTo(0.915);
		expect(screen.a).toBe(1);
	});

	it('returns transparent black when both inputs are transparent', () => {
		expect(compositePixel({ ...source, a: 0 }, { ...backdrop, a: 0 }, 1, 1, 'screen')).toEqual({
			r: 0,
			g: 0,
			b: 0,
			a: 0
		});
	});
});

describe('ordered layer CPU oracle', () => {
	it('composites three layers from bottom to top across every blend mode', () => {
		const result = compositeLayers([
			{ color: { r: 0.1, g: 0.2, b: 0.3, a: 1 } },
			{ color: { r: 0.8, g: 0.5, b: 0.25, a: 0.75 }, opacity: 0.6, mask: 0.5, mode: 'multiply' },
			{ color: { r: 0.3, g: 0.7, b: 0.4, a: 0.5 }, opacity: 0.8, mode: 'screen' }
		]);
		expect(result).toEqual({
			r: expect.closeTo(0.20404, 5),
			g: expect.closeTo(0.4078, 5),
			b: expect.closeTo(0.369475, 5),
			a: 1
		});
	});

	it('preserves transparent edges and makes order observable', () => {
		const transparent = { r: 1, g: 0, b: 0, a: 0 };
		const blue = { r: 0, g: 0, b: 1, a: 0.5 };
		const red = { r: 1, g: 0, b: 0, a: 0.5 };
		expect(compositeLayers([{ color: transparent }, { color: blue }])).toEqual(blue);
		expect(compositeLayers([{ color: blue }, { color: red }])).not.toEqual(
			compositeLayers([{ color: red }, { color: blue }])
		);
	});

	it('models linear RGBA8 storage after every compositor pass', () => {
		const gray = srgbToLinear(128 / 255);
		expect(linearToSrgb(gray)).toBeCloseTo(128 / 255, 10);
		expect([...compositeRgba8(1, 1, [{ pixels: Uint8Array.of(18, 42, 160, 255) }])]).toEqual([
			22, 42, 160, 255
		]);
		const result = compositeRgba8(2, 1, [
			{ pixels: Uint8Array.of(0, 0, 255, 255, 10, 20, 30, 0) },
			{
				pixels: Uint8Array.of(255, 0, 0, 128, 240, 120, 60, 255),
				opacity: 0.5,
				mask: Uint8Array.of(255, 0),
				mode: 'normal'
			}
		]);
		expect([...result]).toEqual([137, 0, 224, 255, 0, 0, 0, 0]);
	});

	it('rejects fixture dimensions that cannot map to pixels', () => {
		expect(() => compositeRgba8(1, 1, [{ pixels: Uint8Array.of(0, 0, 0) }])).toThrow(
			'Layer pixel or mask length does not match compositor dimensions'
		);
	});
});
