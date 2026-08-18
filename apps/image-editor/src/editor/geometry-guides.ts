import type { LayerBounds } from '../model/editor-document';

export type GuideOrientation = 'horizontal' | 'vertical';
export type SnapSource = 'grid' | 'guide' | 'document' | 'layer';

export interface GeometryGuide {
	readonly orientation: GuideOrientation;
	readonly position: number;
	readonly source: SnapSource;
}

export interface SnapGuide {
	readonly orientation: GuideOrientation;
	readonly position: number;
}

export interface GeometrySnapSettings {
	readonly enabled: boolean;
	readonly smartAlignment: boolean;
	readonly grid: boolean;
	readonly gridSize: number;
	readonly guides: boolean;
	readonly threshold: number;
}

export interface GeometrySnapResult {
	readonly bounds: LayerBounds;
	readonly guides: ReadonlyArray<GeometryGuide>;
}

const DEFAULT_SETTINGS: GeometrySnapSettings = {
	enabled: false,
	smartAlignment: true,
	grid: false,
	gridSize: 10,
	guides: false,
	threshold: 6
};

function finite(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

function nearest(value: number, candidates: ReadonlyArray<{ value: number; source: SnapSource }>, threshold: number) {
	let best: { value: number; source: SnapSource; distance: number } | undefined;
	for (const candidate of candidates) {
		const distance = Math.abs(candidate.value - value);
		if (distance > threshold) {
			continue;
		}
		if (!best || distance < best.distance || (distance === best.distance && candidate.source < best.source)) {
			best = { ...candidate, distance };
		}
	}
	return best;
}

function layerCandidates(bounds: LayerBounds): {
	readonly x: ReadonlyArray<number>;
	readonly y: ReadonlyArray<number>;
} {
	return {
		x: [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
		y: [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height]
	};
}

function targetCandidates(
	targets: ReadonlyArray<LayerBounds>,
	document: Pick<LayerBounds, 'width' | 'height'>,
	settings: GeometrySnapSettings,
	guides: ReadonlyArray<SnapGuide>
): { readonly x: ReadonlyArray<{ value: number; source: SnapSource }>; readonly y: ReadonlyArray<{ value: number; source: SnapSource }> } {
	const x: Array<{ value: number; source: SnapSource }> = [];
	const y: Array<{ value: number; source: SnapSource }> = [];
	if (settings.smartAlignment) {
		x.push(
			{ value: 0, source: 'document' },
			{ value: document.width / 2, source: 'document' },
			{ value: document.width, source: 'document' }
		);
		y.push(
			{ value: 0, source: 'document' },
			{ value: document.height / 2, source: 'document' },
			{ value: document.height, source: 'document' }
		);
		for (const target of targets) {
			const candidate = layerCandidates(target);
			x.push(...candidate.x.map(value => ({ value, source: 'layer' as const })));
			y.push(...candidate.y.map(value => ({ value, source: 'layer' as const })));
		}
	}
	if (settings.grid && settings.gridSize > 0) {
		const gridSize = Math.max(1, Math.round(settings.gridSize));
		for (let value = 0; value <= document.width; value += gridSize) {
			x.push({ value, source: 'grid' });
		}
		for (let value = 0; value <= document.height; value += gridSize) {
			y.push({ value, source: 'grid' });
		}
	}
	if (settings.guides) {
		for (const guide of guides) {
			(guide.orientation === 'vertical' ? x : y).push({ value: guide.position, source: 'guide' });
		}
	}
	return { x, y };
}

export function snapGeometryBounds(
	bounds: LayerBounds,
	targets: ReadonlyArray<LayerBounds>,
	document: Pick<LayerBounds, 'width' | 'height'>,
	settings: Partial<GeometrySnapSettings> = {},
	guides: ReadonlyArray<SnapGuide> = []
): GeometrySnapResult {
	const resolved = { ...DEFAULT_SETTINGS, ...settings };
	const threshold = Math.max(0, finite(resolved.threshold, DEFAULT_SETTINGS.threshold));
	if (!resolved.enabled) {
		return { bounds: { ...bounds }, guides: [] };
	}
	const candidates = targetCandidates(targets, document, resolved, guides);
	const current = layerCandidates(bounds);
	const xMatches = current.x.map(value => nearest(value, candidates.x, threshold));
	const yMatches = current.y.map(value => nearest(value, candidates.y, threshold));
	const xMatch = xMatches.find(Boolean);
	const yMatch = yMatches.find(Boolean);
	const next = { ...bounds };
	const aligned: Array<GeometryGuide> = [];
	if (xMatch) {
		const offset = xMatch.value - current.x[xMatches.indexOf(xMatch)];
		next.x += offset;
		if (resolved.smartAlignment || xMatch.source === 'guide') {
			aligned.push({ orientation: 'vertical', position: xMatch.value, source: xMatch.source });
		}
	}
	if (yMatch) {
		const offset = yMatch.value - current.y[yMatches.indexOf(yMatch)];
		next.y += offset;
		if (resolved.smartAlignment || yMatch.source === 'guide') {
			aligned.push({ orientation: 'horizontal', position: yMatch.value, source: yMatch.source });
		}
	}
	return { bounds: next, guides: aligned };
}

export function snapValue(value: number, settings: Pick<GeometrySnapSettings, 'enabled' | 'grid' | 'gridSize' | 'threshold'>): number {
	if (!settings.enabled || !settings.grid || settings.gridSize <= 0) {
		return value;
	}
	const grid = Math.max(1, Math.round(settings.gridSize));
	const snapped = Math.round(value / grid) * grid;
	return Math.abs(snapped - value) <= Math.max(0, settings.threshold) ? snapped : value;
}

export const DEFAULT_GEOMETRY_SNAP_SETTINGS = DEFAULT_SETTINGS;
