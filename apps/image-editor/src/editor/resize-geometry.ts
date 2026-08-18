import type { LayerBounds } from '../model/editor-document';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const MIN_SIZE = 24;

function size(value: number): number {
	return Math.max(MIN_SIZE, Math.round(value));
}

function withRatio(
	bounds: LayerBounds,
	handle: ResizeHandle,
	width: number,
	height: number,
	aspectRatio: number
): LayerBounds {
	const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : bounds.width / bounds.height;
	const horizontal = handle.includes('e') || handle.includes('w');
	const isSideHandle = !handle.includes('n') && !handle.includes('s');
	const widthDriven = horizontal && (
		isSideHandle ||
		Math.abs(width - bounds.width) >= Math.abs(height - bounds.height)
	);
	let nextWidth = size(Math.max(height * ratio, MIN_SIZE * ratio));
	let nextHeight = size(Math.max(height, MIN_SIZE));
	if (widthDriven) {
		nextWidth = size(Math.max(width, MIN_SIZE * ratio));
		nextHeight = size(Math.max(nextWidth / ratio, MIN_SIZE));
	}
	const right = bounds.x + bounds.width;
	const bottom = bounds.y + bounds.height;
	const nextX = handle.includes('w') ?
		right - nextWidth :
		(handle.includes('e') ?
			bounds.x :
			bounds.x + (bounds.width - nextWidth) / 2);
	const nextY = handle.includes('n') ?
		bottom - nextHeight :
		(handle.includes('s') ?
			bounds.y :
			bounds.y + (bounds.height - nextHeight) / 2);
	return { ...bounds, x: nextX, y: nextY, width: nextWidth, height: nextHeight };
}

export function resizeLayerBounds(
	start: LayerBounds,
	handle: ResizeHandle,
	deltaX: number,
	deltaY: number,
	lockAspectRatio = false
): LayerBounds {
	const bounds = { ...start };
	let width = bounds.width;
	let height = bounds.height;

	if (handle.includes('e')) {
		width = size(bounds.width + deltaX);
	}
	if (handle.includes('w')) {
		width = size(bounds.width - deltaX);
	}
	if (handle.includes('s')) {
		height = size(bounds.height + deltaY);
	}
	if (handle.includes('n')) {
		height = size(bounds.height - deltaY);
	}

	if (lockAspectRatio) {
		return withRatio(bounds, handle, width, height, bounds.width / bounds.height);
	}

	if (handle.includes('w')) {
		bounds.x = Math.round(bounds.x + bounds.width - width);
	}
	if (handle.includes('n')) {
		bounds.y = Math.round(bounds.y + bounds.height - height);
	}
	bounds.width = width;
	bounds.height = height;
	return bounds;
}
