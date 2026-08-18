import { COMPOSITOR_PACKAGE_VERSION, createCompositor } from './compositor';

describe('framework-neutral compositor package seam', () => {
	it('exposes a versioned, DOM-free CPU compositor contract', () => {
		expect(COMPOSITOR_PACKAGE_VERSION).toBe('compositor-v1');

		const compositor = createCompositor(1, 1, [
			{ id: 'base', pixels: Uint8Array.of(0, 0, 255, 255) },
			{ id: 'overlay', pixels: Uint8Array.of(255, 0, 0, 128), opacity: 0.5 }
		]);

		expect(compositor.render()).toMatchObject({
			width: 1,
			height: 1,
			pixels: expect.any(Uint8ClampedArray)
		});
		expect([...compositor.render().pixels]).toEqual([137, 0, 224, 255]);
	});

	it('copies layer buffers at the seam so framework consumers cannot mutate state', () => {
		const pixels = Uint8Array.of(10, 20, 30, 255);
		const compositor = createCompositor(1, 1, [{ id: 'layer', pixels }]);
		pixels[0] = 255;

		expect(compositor.getLayers()[0].pixels[0]).toBe(10);
		expect(compositor.render().pixels[0]).toBe(13);
	});

	it('rejects duplicate IDs, invalid dimensions, and mismatched buffers', () => {
		expect(() => createCompositor(0, 1)).toThrow('Invalid compositor dimensions');
		expect(() =>
			createCompositor(1, 1, [
				{ id: 'same', pixels: Uint8Array.of(0, 0, 0, 255) },
				{ id: 'same', pixels: Uint8Array.of(0, 0, 0, 255) }
			])
		).toThrow('Duplicate compositor layer ID');
		expect(() =>
			createCompositor(1, 1, [{ id: 'bad', pixels: Uint8Array.of(0, 0, 0) }])
		).toThrow('Layer pixel length does not match compositor dimensions');
	});
});
