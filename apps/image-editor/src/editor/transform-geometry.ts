import type { LayerBounds } from '../model/editor-document';

export interface TransformPoint {
	readonly x: number;
	readonly y: number;
}

export type FlipAxis = 'x' | 'y' | 'both';

export interface TransformPivot extends TransformPoint {
	readonly relative?: boolean;
}

export interface TransformCorners {
	readonly topLeft: TransformPoint;
	readonly topRight: TransformPoint;
	readonly bottomRight: TransformPoint;
	readonly bottomLeft: TransformPoint;
}

export interface GeometryTransform {
	readonly pivot?: TransformPivot;
	readonly flip?: FlipAxis;
	readonly skewX?: number;
	readonly skewY?: number;
}

export class UnsupportedTransformError extends Error {
	readonly code = 'unsupported-transform' as const;

	constructor(operation: string) {
		super(`${operation} transform is unsupported`);
		this.name = 'UnsupportedTransformError';
	}
}

function validPoint(point: TransformPoint): boolean {
	return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validatePoint(point: TransformPoint, label: string): void {
	if (!validPoint(point)) {
		throw new Error(`Invalid ${label} transform point`);
	}
}

function validateBounds(bounds: LayerBounds): void {
	if (
		!Number.isFinite(bounds.x) ||
		!Number.isFinite(bounds.y) ||
		!Number.isFinite(bounds.width) ||
		!Number.isFinite(bounds.height) ||
		bounds.width <= 0 ||
		bounds.height <= 0
	) {
		throw new Error('Invalid transform bounds');
	}
}

export function boundsCorners(bounds: LayerBounds): TransformCorners {
	validateBounds(bounds);
	return {
		topLeft: { x: bounds.x, y: bounds.y },
		topRight: { x: bounds.x + bounds.width, y: bounds.y },
		bottomRight: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
		bottomLeft: { x: bounds.x, y: bounds.y + bounds.height }
	};
}

export function cornersBounds(corners: TransformCorners): LayerBounds {
	const points = Object.values(corners);
	for (const [index, point] of points.entries()) {
		validatePoint(point, `corner-${index}`);
	}
	const left = Math.min(...points.map(point => point.x));
	const top = Math.min(...points.map(point => point.y));
	const right = Math.max(...points.map(point => point.x));
	const bottom = Math.max(...points.map(point => point.y));
	if (right <= left || bottom <= top) {
		throw new Error('Invalid transformed bounds');
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
}

function defaultPivot(bounds: LayerBounds, pivot?: TransformPivot): TransformPoint {
	if (!pivot) {
		return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
	}
	validatePoint(pivot, 'pivot');
	return pivot.relative ?
		{ x: bounds.x + pivot.x * bounds.width, y: bounds.y + pivot.y * bounds.height } :
		pivot;
}

export function transformPoint(
	point: TransformPoint,
	bounds: LayerBounds,
	transform: GeometryTransform = {}
): TransformPoint {
	validatePoint(point, 'input');
	validateBounds(bounds);
	const pivot = defaultPivot(bounds, transform.pivot);
	const flip = transform.flip ?? undefined;
	const skewX = transform.skewX ?? 0;
	const skewY = transform.skewY ?? 0;
	if (!Number.isFinite(skewX) || !Number.isFinite(skewY)) {
		throw new TypeError('Invalid skew transform');
	}
	if (flip && flip !== 'x' && flip !== 'y' && flip !== 'both') {
		throw new Error('Invalid flip transform');
	}
	let x = point.x - pivot.x;
	let y = point.y - pivot.y;
	if (flip === 'x' || flip === 'both') {
		x = -x;
	}
	if (flip === 'y' || flip === 'both') {
		y = -y;
	}
	const skewXRadians = skewX * Math.PI / 180;
	const skewYRadians = skewY * Math.PI / 180;
	return {
		x: pivot.x + x + Math.tan(skewXRadians) * y,
		y: pivot.y + y + Math.tan(skewYRadians) * x
	};
}

export function transformBounds(
	bounds: LayerBounds,
	transform: GeometryTransform = {}
): TransformCorners {
	const corners = boundsCorners(bounds);
	return {
		topLeft: transformPoint(corners.topLeft, bounds, transform),
		topRight: transformPoint(corners.topRight, bounds, transform),
		bottomRight: transformPoint(corners.bottomRight, bounds, transform),
		bottomLeft: transformPoint(corners.bottomLeft, bounds, transform)
	};
}

function solveLinearSystem(matrix: Array<Array<number>>, values: Array<number>): Array<number> {
	const size = values.length;
	const augmented = matrix.map((row, index) => [...row, values[index]]);
	for (let column = 0; column < size; column += 1) {
		let pivot = column;
		for (let row = column + 1; row < size; row += 1) {
			if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
				pivot = row;
			}
		}
		if (Math.abs(augmented[pivot][column]) < 1e-12) {
			throw new Error('Invalid perspective transform');
		}
		const pivotRow = augmented[pivot];
		augmented[pivot] = augmented[column];
		augmented[column] = pivotRow;
		const divisor = augmented[column][column];
		for (let index = column; index <= size; index += 1) {
			augmented[column][index] /= divisor;
		}
		const rows = Array.from({ length: size }, (_, index) => index).filter(index => index !== column);
		for (const row of rows) {
			const factor = augmented[row][column];
			for (let index = column; index <= size; index += 1) {
				augmented[row][index] -= factor * augmented[column][index];
			}
		}
	}
	return augmented.map(row => row[size]);
}

function homography(source: TransformCorners, target: TransformCorners): Array<number> {
	const sourcePoints = Object.values(source);
	const targetPoints = Object.values(target);
	const matrix: Array<Array<number>> = [];
	const values: Array<number> = [];
	for (let index = 0; index < 4; index += 1) {
		const { x, y } = sourcePoints[index];
		const targetPoint = targetPoints[index];
		matrix.push([x, y, 1, 0, 0, 0, -targetPoint.x * x, -targetPoint.x * y]);
		values.push(targetPoint.x);
		matrix.push([0, 0, 0, x, y, 1, -targetPoint.y * x, -targetPoint.y * y]);
		values.push(targetPoint.y);
	}
	return [...solveLinearSystem(matrix, values), 1];
}

function mapHomography(matrix: Array<number>, point: TransformPoint): TransformPoint {
	const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
	if (Math.abs(denominator) < 1e-12) {
		throw new Error('Invalid perspective transform');
	}
	const normalize = (value: number): number => {
		const rounded = Math.round(value * 1e12) / 1e12;
		return rounded === 0 ? 0 : rounded;
	};
	return {
		x: normalize((matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator),
		y: normalize((matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator)
	};
}

export interface PerspectiveTransform {
	readonly mapPoint: (point: TransformPoint) => TransformPoint;
	readonly inversePoint: (point: TransformPoint) => TransformPoint;
}

export function createPerspectiveTransform(
	source: TransformCorners,
	target: TransformCorners
): PerspectiveTransform {
	for (const [index, point] of Object.values(source).entries()) {
		validatePoint(point, `source-corner-${index}`);
	}
	for (const [index, point] of Object.values(target).entries()) {
		validatePoint(point, `target-corner-${index}`);
	}
	const forward = homography(source, target);
	const inverse = homography(target, source);
	return {
		mapPoint: point => {
			validatePoint(point, 'perspective input');
			return mapHomography(forward, point);
		},
		inversePoint: point => {
			validatePoint(point, 'perspective inverse input');
			return mapHomography(inverse, point);
		}
	};
}

export function warpBounds(bounds: LayerBounds, target: TransformCorners): TransformCorners {
	const transform = createPerspectiveTransform(boundsCorners(bounds), target);
	return {
		topLeft: transform.mapPoint({ x: bounds.x, y: bounds.y }),
		topRight: transform.mapPoint({ x: bounds.x + bounds.width, y: bounds.y }),
		bottomRight: transform.mapPoint({
			x: bounds.x + bounds.width,
			y: bounds.y + bounds.height
		}),
		bottomLeft: transform.mapPoint({ x: bounds.x, y: bounds.y + bounds.height })
	};
}

export const freeTransform = warpBounds;
