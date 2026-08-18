import { describe, expect, it } from 'vitest';
import { keyboardResize, transformHandleLabel, transformState } from './transform-accessibility';
import type { ResizeHandle } from './resize-geometry';

const bounds = { x: 10, y: 20, width: 100, height: 50 };

describe('transform accessibility', () => {
	it('gives every handle a unique, layer-specific accessible name', () => {
		const handles: Array<ResizeHandle> = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
		const labels = handles.map(handle => transformHandleLabel(handle, 'Photo'));
		expect(new Set(labels).size).toBe(8);
		expect(labels).toContain('Resize Photo top left');
		expect(transformHandleLabel('rotate', 'Photo')).toBe('Rotate Photo');
	});

	it('exposes current geometry and lock state as readable status', () => {
		expect(transformState('Photo', bounds, 15.4, false)).toBe('Photo: position 10, 20; size 100 by 50; rotation 15 degrees');
		expect(transformState('', bounds, 0, true)).toContain('selected layer');
		expect(transformState('Photo', bounds, 0, true)).toContain(', locked');
	});

	it('moves resize handles with keyboard arrows and preserves the opposite anchor', () => {
		expect(keyboardResize(bounds, 'se', 'ArrowRight', 10)).toEqual({ ...bounds, width: 110 });
		expect(keyboardResize(bounds, 'nw', 'ArrowLeft', 10)).toEqual({ x: 0, y: 20, width: 110, height: 50 });
		expect(keyboardResize(bounds, 'e', 'Enter', 10)).toBeUndefined();
	});
});
