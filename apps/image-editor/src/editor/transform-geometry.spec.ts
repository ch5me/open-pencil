import { describe, expect, it } from 'vitest';
import {
	boundsCorners,
	cornersBounds,
	createPerspectiveTransform,
	freeTransform,
	transformBounds,
	transformPoint,
	warpBounds,
	type TransformCorners
} from './transform-geometry';

const bounds = { x: 10, y: 20, width: 100, height: 60 };

describe('transform geometry', () => {
	it('keeps the default pivot fixed for flips and skew', () => {
		const pivot = { x: 60, y: 50 };
		expect(transformPoint(pivot, bounds, { flip: 'both', skewX: 20, skewY: -10 })).toEqual(pivot);
		expect(transformBounds(bounds, { flip: 'x' })).toEqual({
			topLeft: { x: 110, y: 20 },
			topRight: { x: 10, y: 20 },
			bottomRight: { x: 10, y: 80 },
			bottomLeft: { x: 110, y: 80 }
		});
	});

	it('supports relative and absolute pivots', () => {
		expect(transformPoint({ x: 10, y: 20 }, bounds, {
			pivot: { x: 0, y: 0, relative: true },
			flip: 'x'
		})).toEqual({ x: 10, y: 20 });
		expect(transformPoint({ x: 20, y: 20 }, bounds, {
			pivot: { x: 10, y: 20 },
			flip: 'x'
		})).toEqual({ x: 0, y: 20 });
	});

	it('maps perspective corners and preserves inverse round trips', () => {
		const source = boundsCorners(bounds);
		const target: TransformCorners = {
			topLeft: { x: 0, y: 4 },
			topRight: { x: 120, y: 0 },
			bottomRight: { x: 105, y: 80 },
			bottomLeft: { x: -10, y: 70 }
		};
		const transform = createPerspectiveTransform(source, target);
		expect(transform.mapPoint(source.topLeft)).toEqual(target.topLeft);
		expect(transform.mapPoint(source.bottomRight)).toEqual(target.bottomRight);
		const sample = { x: 43, y: 51 };
		const roundTrip = transform.inversePoint(transform.mapPoint(sample));
		expect(roundTrip.x).toBeCloseTo(sample.x, 8);
		expect(roundTrip.y).toBeCloseTo(sample.y, 8);
	});

	it('supports warp/free-transform aliases and computes enclosing bounds', () => {
		const target: TransformCorners = {
			topLeft: { x: 0, y: 4 },
			topRight: { x: 120, y: 0 },
			bottomRight: { x: 105, y: 80 },
			bottomLeft: { x: -10, y: 70 }
		};
		expect(warpBounds(bounds, target)).toEqual(target);
		expect(freeTransform(bounds, target)).toEqual(target);
		expect(cornersBounds(target)).toEqual({ x: -10, y: 0, width: 130, height: 80 });
	});

	it('rejects invalid values and stays deterministic across a corpus', () => {
		expect(() => transformPoint({ x: Number.NaN, y: 0 }, bounds)).toThrow('Invalid input transform point');
		expect(() => transformBounds({ ...bounds, width: 0 })).toThrow('Invalid transform bounds');
		for (let index = 0; index < 256; index += 1) {
			const result = transformPoint(
				{ x: index % 100, y: -(index % 80) },
				bounds,
				{ skewX: (index % 11) - 5, skewY: (index % 7) - 3, flip: index % 2 ? 'x' : undefined }
			);
			expect(Number.isFinite(result.x)).toBe(true);
			expect(Number.isFinite(result.y)).toBe(true);
		}
	});
});
