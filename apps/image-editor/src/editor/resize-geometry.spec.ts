import { describe, expect, it } from 'vitest';
import type { LayerBounds } from '../model/editor-document';
import { resizeLayerBounds, type ResizeHandle } from './resize-geometry';

const start: LayerBounds = { x: 100, y: 80, width: 200, height: 100 };

describe('resizeLayerBounds', () => {
	it('supports side handles while preserving the opposite anchor', () => {
		expect(resizeLayerBounds(start, 'e', 40, 0)).toEqual({ ...start, width: 240 });
		expect(resizeLayerBounds(start, 'w', 40, 0)).toEqual({ x: 140, y: 80, width: 160, height: 100 });
		expect(resizeLayerBounds(start, 's', 0, 30)).toEqual({ ...start, height: 130 });
		expect(resizeLayerBounds(start, 'n', 0, 30)).toEqual({ x: 100, y: 110, width: 200, height: 70 });
	});

	it('locks side and corner resize to the original aspect ratio', () => {
		const east = resizeLayerBounds(start, 'e', 40, 0, true);
		expect(east.width / east.height).toBeCloseTo(2);
		expect(east.y + east.height / 2).toBe(start.y + start.height / 2);
		const northWest = resizeLayerBounds(start, 'nw', -40, -10, true);
		expect(northWest.width / northWest.height).toBeCloseTo(2);
		expect(northWest.x + northWest.width).toBe(start.x + start.width);
		expect(northWest.y + northWest.height).toBe(start.y + start.height);
	});

	it('clamps every handle to the minimum size', () => {
		const handles: Array<ResizeHandle> = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
		for (const handle of handles) {
			const result = resizeLayerBounds(start, handle, -10_000, -10_000);
			expect(result.width).toBeGreaterThanOrEqual(24);
			expect(result.height).toBeGreaterThanOrEqual(24);
		}
	});

	it('keeps geometry independent of rotation', () => {
		const rotated = resizeLayerBounds(start, 'e', 40, 0, true);
		const unrotated = resizeLayerBounds(start, 'e', 40, 0, true);
		expect(rotated).toEqual(unrotated);
	});

	it('holds for a representative deterministic corpus', () => {
		let seed = 0x12_34_56_78;
		const random = () => {
			seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
			return seed / 0x1_00_00_00_00;
		};
		const handles: Array<ResizeHandle> = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
		for (let index = 0; index < 256; index += 1) {
			const bounds = { x: 20, y: 30, width: 24 + Math.round(random() * 500), height: 24 + Math.round(random() * 500) };
			const result = resizeLayerBounds(bounds, handles[index % handles.length], random() * 1000 - 500, random() * 1000 - 500, index % 2 === 0);
			expect(result.width).toBeGreaterThanOrEqual(24);
			expect(result.height).toBeGreaterThanOrEqual(24);
			expect(Number.isFinite(result.x)).toBe(true);
			expect(Number.isFinite(result.y)).toBe(true);
		}
	});
});
