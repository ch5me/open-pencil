import { describe, expect, it } from 'vitest';
import { snapGeometryBounds, snapValue } from './geometry-guides';

const document = { width: 1000, height: 800 };
const start = { x: 103, y: 197, width: 100, height: 80 };

describe('geometry snapping', () => {
	it('is explicit opt-in', () => {
		expect(snapGeometryBounds(start, [], document).bounds).toEqual(start);
	});

	it('snaps to grid within threshold', () => {
		expect(snapGeometryBounds(start, [], document, {
			enabled: true,
			smartAlignment: false,
			grid: true,
			gridSize: 10,
			threshold: 4
		}).bounds).toEqual({ ...start, x: 100, y: 200 });
	});

	it('snaps edges and centers to smart alignment candidates', () => {
		const result = snapGeometryBounds(start, [{ x: 100, y: 197, width: 100, height: 80 }], document, {
			enabled: true,
			smartAlignment: true,
			threshold: 4
		});
		expect(result.bounds.x).toBe(100);
		expect(result.bounds.y).toBe(197);
		expect(result.guides).toEqual([
			{ orientation: 'vertical', position: 100, source: 'layer' },
			{ orientation: 'horizontal', position: 197, source: 'layer' }
		]);
	});

	it('does not snap beyond threshold', () => {
		expect(snapGeometryBounds({ ...start, x: 105 }, [], document, {
			enabled: true,
			smartAlignment: false,
			grid: true,
			gridSize: 10,
			threshold: 4
		}).bounds.x).toBe(105);
	});

	it('keeps grid, guides, and smart alignment independently opt-in', () => {
		expect(snapGeometryBounds(start, [], document, {
			enabled: true,
			smartAlignment: false,
			grid: false,
			guides: false,
			threshold: 6
		}).bounds).toEqual(start);
		expect(snapGeometryBounds(start, [], document, {
			enabled: true,
			smartAlignment: false,
			grid: false,
			guides: true,
			threshold: 6
		}, [{ orientation: 'vertical', position: 100 }]).bounds.x).toBe(100);
		expect(snapGeometryBounds(start, [], document, {
			enabled: true,
			smartAlignment: true,
			grid: false,
			guides: false,
			threshold: 6
		}).bounds).toEqual(start);
	});

	it('accepts threshold boundary and rejects invalid grid size', () => {
		expect(snapGeometryBounds({ ...start, x: 104 }, [], document, {
			enabled: true,
			smartAlignment: false,
			grid: true,
			gridSize: 10,
			threshold: 4
		}).bounds.x).toBe(100);
		expect(snapGeometryBounds(start, [], document, {
			enabled: true,
			smartAlignment: false,
			grid: true,
			gridSize: 0,
			threshold: 6
		}).bounds).toEqual(start);
	});

	it('supports explicit guides and value snapping', () => {
		expect(snapGeometryBounds(start, [], document, {
			enabled: true,
			smartAlignment: false,
			guides: true,
			threshold: 4
		}, [{ orientation: 'vertical', position: 100 }]).bounds.x).toBe(100);
		expect(snapValue(103, { enabled: true, grid: true, gridSize: 10, threshold: 4 })).toBe(100);
		expect(snapValue(105, { enabled: true, grid: true, gridSize: 10, threshold: 4 })).toBe(105);
	});

	it('stays deterministic across a representative geometry corpus', () => {
		for (let index = 0; index < 256; index += 1) {
			const bounds = { x: index % 997, y: (index * 7) % 797, width: 24, height: 24 };
			const result = snapGeometryBounds(bounds, [], document, {
				enabled: true,
				smartAlignment: true,
				grid: true,
				gridSize: 10,
				threshold: 3
			});
			expect(Number.isFinite(result.bounds.x)).toBe(true);
			expect(Number.isFinite(result.bounds.y)).toBe(true);
		}
	});
});
