import type { LayerBounds } from '../model/editor-document';
import { resizeLayerBounds, type ResizeHandle } from './resize-geometry';

export function transformHandleLabel(handle: ResizeHandle | 'rotate', layerName: string): string {
	const name = layerName.trim() || 'selected layer';
	if (handle === 'rotate') {
		return `Rotate ${name}`;
	}
	const labels: Record<ResizeHandle, string> = {
		nw: 'top left',
		n: 'top',
		ne: 'top right',
		e: 'right',
		se: 'bottom right',
		s: 'bottom',
		sw: 'bottom left',
		w: 'left'
	};
	return `Resize ${name} ${labels[handle]}`;
}

export function transformState(
	layerName: string,
	bounds: LayerBounds,
	rotation: number,
	locked: boolean
): string {
	const name = layerName.trim() || 'selected layer';
	const lock = locked ? ', locked' : '';
	return `${name}: position ${Math.round(bounds.x)}, ${Math.round(bounds.y)}; size ${Math.round(bounds.width)} by ${Math.round(bounds.height)}; rotation ${Math.round(rotation)} degrees${lock}`;
}

export function keyboardResize(
	bounds: LayerBounds,
	handle: ResizeHandle,
	key: string,
	step: number
): LayerBounds | undefined {
	const delta = {
		x: key === 'ArrowRight' ? step : (key === 'ArrowLeft' ? -step : 0),
		y: key === 'ArrowDown' ? step : (key === 'ArrowUp' ? -step : 0)
	};
	if (delta.x === 0 && delta.y === 0) {
		return undefined;
	}
	return resizeLayerBounds(bounds, handle, delta.x, delta.y);
}
