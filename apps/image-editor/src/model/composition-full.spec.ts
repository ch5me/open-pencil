import {
	COMPOSITION_FULL_VERSION,
	CompositionCapabilityError,
	composeRgba16f,
	composeRgba8,
	composeWithSkia,
	type CompositionLayer
} from './composition-full';

const raster = (pixels: Array<number>, width = 2, height = 2) => ({
	width,
	height,
	pixels: Uint8ClampedArray.from(pixels)
});

describe('composition-full-v1 consuming RGBA8 renderer', () => {
	it('matches the pixel oracle for nested groups', () => {
		const output = composeRgba8({
			width: 2,
			height: 1,
			layers: [{
				id: 'outer',
				kind: 'group',
				children: [{
					id: 'red',
					kind: 'raster',
					raster: raster([255, 0, 0, 255, 0, 0, 0, 0], 2, 1)
				}, {
					id: 'inner',
					kind: 'group',
					children: [{
						id: 'green',
						kind: 'raster',
						raster: raster([0, 0, 0, 0, 0, 255, 0, 255], 2, 1)
					}]
				}]
			}]
		});

		expect([...output.pixels]).toEqual([
			255, 0, 0, 255,
			0, 255, 0, 255
		]);
		expect(output.pixels.some(value => value !== 0)).toBe(true);
	});

	it('composes nonzero raster pixels with bounds and rotation', () => {
		const layer: CompositionLayer = {
			id: 'base',
			kind: 'raster',
			raster: raster([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
			bounds: { x: 0, y: 0, width: 2, height: 2 },
			rotation: 90
		};
		const output = composeRgba8({ width: 2, height: 2, layers: [layer] });
		expect(COMPOSITION_FULL_VERSION).toBe('composition-full-v1');
		expect(output.pixels.some(value => value !== 0)).toBe(true);
		expect(output.pixels[3]).toBe(0);
	});

	it('applies raster masks, clipping, groups, sections, and adjustments', () => {
		const base: CompositionLayer = {
			id: 'base',
			kind: 'raster',
			raster: raster([20, 40, 60, 255, 20, 40, 60, 255, 20, 40, 60, 255, 20, 40, 60, 255]),
			mask: {
				width: 2,
				height: 2,
				pixels: Uint8ClampedArray.from([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
			}
		};
		const child: CompositionLayer = {
			id: 'child',
			kind: 'raster',
			clipped: true,
			raster: raster([240, 20, 20, 255, 240, 20, 20, 255, 240, 20, 20, 255, 240, 20, 20, 255])
		};
		const output = composeRgba8({
			width: 2,
			height: 2,
			layers: [{
				id: 'section',
				kind: 'section',
				children: [{
					id: 'group',
					kind: 'group',
					children: [base, child]
				}]
			}, {
				id: 'adjust',
				kind: 'adjustment',
				adjustments: { brightness: 0.1 }
			}]
		});
		expect(output.pixels.some(value => value !== 0)).toBe(true);
		expect(output.pixels[3]).toBeGreaterThan(0);
	});

	it('uses a pixel oracle for nested groups', () => {
		const output = composeRgba8({
			width: 1,
			height: 1,
			layers: [{
				id: 'outer',
				kind: 'group',
				opacity: 0.5,
				blendMode: 'screen',
				children: [{
					id: 'inner',
					kind: 'group',
					opacity: 0.75,
					children: [{
						id: 'blue',
						kind: 'raster',
						raster: raster([0, 0, 255, 255], 1, 1)
					}, {
						id: 'red',
						kind: 'raster',
						opacity: 0.5,
						raster: raster([255, 0, 0, 255], 1, 1)
					}]
				}]
			}]
		});
		const expected = [188, 0, 188, 72];
		expect([...output.pixels]).toEqual(expected);
		expect(output.pixels.some(value => value !== 0)).toBe(true);

		const seededDefect = [...expected];
		seededDefect[0] += 1;
		expect([...output.pixels]).not.toEqual(seededDefect);
	});

	it('rejects seeded unsupported paths with typed errors', () => {
		expect(() => composeRgba16f()).toThrowError(CompositionCapabilityError);
		expect(() => composeWithSkia()).toThrowError(CompositionCapabilityError);
		expect(() => composeRgba8({
			width: 1,
			height: 1,
			layers: [{ id: 'group', kind: 'group', clipped: true, children: [] }]
		})).toThrow('E_CLIPPED_GROUP_UNSUPPORTED');
	});
});
