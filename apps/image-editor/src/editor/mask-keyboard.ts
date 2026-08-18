export type MaskCursorKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
export type MaskBrushMode = 'erase' | 'reveal';

export interface MaskCursor {
	readonly x: number;
	readonly y: number;
}

export interface MaskCursorBounds {
	readonly width: number;
	readonly height: number;
}

export function moveMaskCursor(
	cursor: MaskCursor,
	key: MaskCursorKey,
	step: number,
	bounds: MaskCursorBounds
): MaskCursor {
	const deltaX = key === 'ArrowRight' ? step : (key === 'ArrowLeft' ? -step : 0);
	const deltaY = key === 'ArrowDown' ? step : (key === 'ArrowUp' ? -step : 0);
	return {
		x: Math.max(0, Math.min(bounds.width, cursor.x + deltaX)),
		y: Math.max(0, Math.min(bounds.height, cursor.y + deltaY))
	};
}

export function maskCursorCenter(bounds: MaskCursorBounds): MaskCursor {
	return { x: bounds.width / 2, y: bounds.height / 2 };
}

export function toggleMaskBrushMode(mode: MaskBrushMode): MaskBrushMode {
	return mode === 'erase' ? 'reveal' : 'erase';
}

export function maskKeyboardState(
	layerName: string,
	cursor: MaskCursor,
	mode: MaskBrushMode,
	action?: string
): string {
	const position = `Cursor ${Math.round(cursor.x)}, ${Math.round(cursor.y)}.`;
	return `${layerName} mask. ${mode === 'erase' ? 'Erase' : 'Reveal'} mode. ${position}${action ? ` ${action}` : ''}`;
}
