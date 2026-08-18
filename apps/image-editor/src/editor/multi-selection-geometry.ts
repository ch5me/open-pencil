import type { LayerBounds } from '../model/editor-document';

export {
	boundsCorners,
	cornersBounds,
	createPerspectiveTransform,
	freeTransform,
	transformBounds,
	transformPoint,
	UnsupportedTransformError,
	warpBounds
} from './transform-geometry';
export type {
	FlipAxis,
	GeometryTransform,
	PerspectiveTransform,
	TransformCorners,
	TransformPivot,
	TransformPoint
} from './transform-geometry';

export interface SelectionGeometry {
	readonly id: string;
	readonly bounds: LayerBounds;
	readonly rotation: number;
}

export type SelectionAlignment = 'left' | 'center-horizontal' | 'right' | 'top' | 'center-vertical' | 'bottom';
export type SelectionDistribution = 'horizontal' | 'vertical';

export interface SelectionTransform {
	readonly deltaX?: number;
	readonly deltaY?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly rotationDelta?: number;
}

function finite(value: number | undefined, fallback: number): number {
	return value === undefined ? fallback : value;
}

function validateItem(item: SelectionGeometry): void {
	const { bounds } = item;
	if (
		!item.id ||
		!Number.isFinite(item.rotation) ||
		!Number.isFinite(bounds.x) ||
		!Number.isFinite(bounds.y) ||
		!Number.isFinite(bounds.width) ||
		!Number.isFinite(bounds.height) ||
		bounds.width <= 0 ||
		bounds.height <= 0
	) {
		throw new Error('Invalid selection geometry');
	}
}

export function multiSelectionBounds(items: ReadonlyArray<SelectionGeometry>): LayerBounds | null {
	if (items.length === 0) {
		return null;
	}
	for (const item of items) {
		validateItem(item);
	}
	const left = Math.min(...items.map(item => item.bounds.x));
	const top = Math.min(...items.map(item => item.bounds.y));
	const right = Math.max(...items.map(item => item.bounds.x + item.bounds.width));
	const bottom = Math.max(...items.map(item => item.bounds.y + item.bounds.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

export function alignSelection(
	items: ReadonlyArray<SelectionGeometry>,
	alignment: SelectionAlignment
): Array<SelectionGeometry> {
	const bounds = multiSelectionBounds(items);
	if (!bounds) {
		return [];
	}
	return items.map(item => {
		const next = { ...item, bounds: { ...item.bounds } };
		switch (alignment) {
			case 'left': {
				next.bounds.x = bounds.x;
				break;
			}
			case 'center-horizontal': {
				next.bounds.x = bounds.x + (bounds.width - next.bounds.width) / 2;
				break;
			}
			case 'right': {
				next.bounds.x = bounds.x + bounds.width - next.bounds.width;
				break;
			}
			case 'top': {
				next.bounds.y = bounds.y;
				break;
			}
			case 'center-vertical': {
				next.bounds.y = bounds.y + (bounds.height - next.bounds.height) / 2;
				break;
			}
			case 'bottom': {
				next.bounds.y = bounds.y + bounds.height - next.bounds.height;
				break;
			}
			default: {
				throw new Error(`Invalid selection alignment: ${alignment}`);
			}
		}
		return next;
	});
}

export function distributeSelection(
	items: ReadonlyArray<SelectionGeometry>,
	axis: SelectionDistribution
): Array<SelectionGeometry> {
	const bounds = multiSelectionBounds(items);
	if (!bounds) {
		return [];
	}
	if (items.length < 3) {
		return items.map(item => ({ ...item, bounds: { ...item.bounds } }));
	}
	const sorted = items
		.map((item, index) => ({ item, index }))
		.sort((a, b) => (
			(axis === 'horizontal' ? a.item.bounds.x - b.item.bounds.x : a.item.bounds.y - b.item.bounds.y) ||
			a.index - b.index
		));
	const first = sorted[0]!.item.bounds;
	const last = sorted.at(-1)!.item.bounds;
	const start = axis === 'horizontal' ? first.x : first.y;
	const end = axis === 'horizontal' ? last.x + last.width : last.y + last.height;
	const totalSize = sorted.reduce((sum, entry) => sum + (axis === 'horizontal' ? entry.item.bounds.width : entry.item.bounds.height), 0);
	const gap = (end - start - totalSize) / (sorted.length - 1);
	let cursor = start;
	const next = items.map(item => ({ ...item, bounds: { ...item.bounds } }));
	for (const entry of sorted) {
		const width = axis === 'horizontal' ? entry.item.bounds.width : entry.item.bounds.height;
		const updated = next[entry.index]!.bounds;
		if (axis === 'horizontal') {
			updated.x = cursor;
		} else {
			updated.y = cursor;
		}
		cursor += width + gap;
	}
	return next;
}

export function transformSelection(
	items: ReadonlyArray<SelectionGeometry>,
	transform: SelectionTransform
): Array<SelectionGeometry> {
	const bounds = multiSelectionBounds(items);
	if (!bounds) {
		return [];
	}
	const deltaX = finite(transform.deltaX, 0);
	const deltaY = finite(transform.deltaY, 0);
	const scaleX = finite(transform.scaleX, 1);
	const scaleY = finite(transform.scaleY, 1);
	const rotationDelta = finite(transform.rotationDelta, 0);
	if (
		[deltaX, deltaY, scaleX, scaleY, rotationDelta].some(value => !Number.isFinite(value)) ||
		scaleX <= 0 ||
		scaleY <= 0
	) {
		throw new Error('Invalid selection transform');
	}
	if (rotationDelta !== 0) {
		throw new Error('Multi-selection rotation is unsupported');
	}
	const anchorX = bounds.x + bounds.width / 2;
	const anchorY = bounds.y + bounds.height / 2;
	return items.map(item => {
		const centerX = item.bounds.x + item.bounds.width / 2;
		const centerY = item.bounds.y + item.bounds.height / 2;
		const width = item.bounds.width * scaleX;
		const height = item.bounds.height * scaleY;
		return {
			...item,
			bounds: {
				x: anchorX + (centerX - anchorX) * scaleX - width / 2 + deltaX,
				y: anchorY + (centerY - anchorY) * scaleY - height / 2 + deltaY,
				width,
				height
			}
		};
	});
}

export const getMultiSelectionBounds = multiSelectionBounds;
export const alignMultiSelection = alignSelection;
export const distributeMultiSelection = distributeSelection;
export const transformMultiSelection = transformSelection;
