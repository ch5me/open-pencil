import { describe, expect, it } from 'vitest';
import {
	maskCursorCenter,
	maskKeyboardState,
	moveMaskCursor,
	toggleMaskBrushMode
} from './mask-keyboard';

describe('mask keyboard cursor', () => {
	it('moves by one step and clamps to the mask bounds', () => {
		expect(moveMaskCursor({ x: 4, y: 4 }, 'ArrowLeft', 8, { width: 100, height: 60 })).toEqual({ x: 0, y: 4 });
		expect(moveMaskCursor({ x: 96, y: 56 }, 'ArrowRight', 8, { width: 100, height: 60 })).toEqual({ x: 100, y: 56 });
		expect(moveMaskCursor({ x: 4, y: 4 }, 'ArrowUp', 8, { width: 100, height: 60 })).toEqual({ x: 4, y: 0 });
		expect(moveMaskCursor({ x: 96, y: 56 }, 'ArrowDown', 8, { width: 100, height: 60 })).toEqual({ x: 96, y: 60 });
	});

	it('starts the keyboard journey at the mask center', () => {
		expect(maskCursorCenter({ width: 360, height: 240 })).toEqual({ x: 180, y: 120 });
	});

	it('toggles erase and reveal modes without pointer input', () => {
		expect(toggleMaskBrushMode('erase')).toBe('reveal');
		expect(toggleMaskBrushMode('reveal')).toBe('erase');
	});

	it('describes the selected mask, brush mode, cursor, and latest action', () => {
		expect(maskKeyboardState('Artwork', { x: 180.4, y: 119.6 }, 'erase', 'Mask erased.')).toBe(
			'Artwork mask. Erase mode. Cursor 180, 120. Mask erased.'
		);
	});
});
