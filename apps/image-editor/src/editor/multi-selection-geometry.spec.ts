import { describe, expect, it } from 'vitest';
import {
	alignSelection,
	distributeSelection,
	multiSelectionBounds,
	transformSelection,
	type SelectionGeometry
} from './multi-selection-geometry';

const items: Array<SelectionGeometry> = [
	{ id: 'a', bounds: { x: 10, y: 20, width: 20, height: 30 }, rotation: 12 },
	{ id: 'b', bounds: { x: 60, y: 80, width: 40, height: 20 }, rotation: -8 },
	{ id: 'c', bounds: { x: 130, y: 40, width: 10, height: 10 }, rotation: 0 }
];

describe('multi-selection geometry', () => {
	it('returns empty and single selection bounds safely', () => {
		expect(multiSelectionBounds([])).toBeNull();
		expect(multiSelectionBounds([items[0]])).toEqual(items[0].bounds);
		expect(multiSelectionBounds(items)).toEqual({ x: 10, y: 20, width: 130, height: 80 });
	});

	it('aligns without changing size, id, or rotation', () => {
		const result = alignSelection(items, 'center-vertical');
		expect(result.map(item => item.bounds.y)).toEqual([45, 50, 55]);
		expect(result.map(item => item.rotation)).toEqual([12, -8, 0]);
		expect(result.map(item => item.id)).toEqual(['a', 'b', 'c']);
	});

	it('distributes gaps on the requested axis and preserves input order', () => {
		const result = distributeSelection(items, 'horizontal');
		expect(result.map(item => item.id)).toEqual(['a', 'b', 'c']);
		expect(result.map(item => item.bounds.x)).toEqual([10, 60, 130]);
		expect(distributeSelection(items.slice(0, 2), 'vertical')).toEqual(items.slice(0, 2));
	});

	it('scales around the selection center and translates every item', () => {
		const result = transformSelection(items, { scaleX: 2, scaleY: 2, deltaX: 5, deltaY: -3 });
		expect(result[0].bounds).toEqual({ x: -50, y: -23, width: 40, height: 60 });
		expect(result[1].bounds).toEqual({ x: 50, y: 97, width: 80, height: 40 });
		expect(result.map(item => item.rotation)).toEqual([12, -8, 0]);
	});

	it('rejects invalid geometry and rotation transforms', () => {
		expect(() => multiSelectionBounds([{ ...items[0], bounds: { ...items[0].bounds, width: 0 } }])).toThrow('Invalid selection geometry');
		expect(() => transformSelection(items, { scaleX: 0 })).toThrow('Invalid selection transform');
		expect(() => transformSelection(items, { rotationDelta: 15 })).toThrow('Multi-selection rotation is unsupported');
	});

	it('stays finite for a representative deterministic corpus', () => {
		for (let index = 0; index < 256; index += 1) {
			const result = transformSelection(items, {
				scaleX: 0.5 + (index % 5) / 10,
				scaleY: 0.5 + (index % 7) / 10,
				deltaX: index % 13,
				deltaY: -(index % 11)
			});
			expect(result.every(item => Object.values(item.bounds).every(value => Number.isFinite(value)))).toBe(true);
		}
	});
});
