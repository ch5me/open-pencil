import type { SortableTreeChangeDetails, SortableTreeNode } from '@ch5me/ch5-ui-web';
import type { SceneGraph } from '@open-pencil/scene-graph';
import { moveLayer, type EditorDocument, type LayerBounds } from '../model/editor-document';

export const OPEN_PENCIL_IMAGE_EDITOR_PRODUCERS = {
	openPencilCore: '0.14.1',
	ch5UiWeb: '0.10.0'
} as const;

export type GeometryControlKey = 'x' | 'y' | 'width' | 'height' | 'rotation';

export interface GeometryControl {
	readonly key: GeometryControlKey;
	readonly label: string;
	readonly min: number;
	readonly max: number;
	readonly step: number;
}

export const GEOMETRY_CONTROLS: ReadonlyArray<GeometryControl> = [
	{ key: 'x', label: 'X', min: -1_000_000, max: 1_000_000, step: 1 },
	{ key: 'y', label: 'Y', min: -1_000_000, max: 1_000_000, step: 1 },
	{ key: 'width', label: 'W', min: 24, max: 8192, step: 1 },
	{ key: 'height', label: 'H', min: 24, max: 8192, step: 1 },
	{ key: 'rotation', label: 'Rotation', min: -360, max: 360, step: 1 }
] as const;

export interface GeometryV1 {
	readonly bounds: LayerBounds;
	readonly rotation: number;
}

export function parseGeometryControlValue(key: GeometryControlKey, raw: number | string): number {
	if (typeof raw === 'string' && raw.trim() === '') {
		throw new Error(`Invalid ${key} geometry value`);
	}
	const value = typeof raw === 'number' ? raw : Number(raw);
	const control = GEOMETRY_CONTROLS.find(candidate => candidate.key === key);
	if (!control || !Number.isFinite(value) || value < control.min || value > control.max) {
		throw new Error(`Invalid ${key} geometry value`);
	}
	return value;
}

export function updateGeometryControl(
	geometry: GeometryV1,
	key: GeometryControlKey,
	raw: number | string
): GeometryV1 {
	const value = parseGeometryControlValue(key, raw);
	if (key === 'rotation') {
		return { ...geometry, rotation: value };
	}
	return { ...geometry, bounds: { ...geometry.bounds, [key]: value } };
}

/**
 * Keep the OpenPencil layer tree as a consumer projection of the producer graph.
 * Rendering remains owned by the local Three/Canvas compositor.
 */
export interface LayerTreeNodeSource {
	readonly id: string;
	readonly parentId: string | null;
	readonly name: string;
	readonly locked: boolean;
	readonly visible: boolean;
}

export function sortableNodesFromLayers(layers: ReadonlyArray<LayerTreeNodeSource>): Array<SortableTreeNode> {
	return layers.map(layer => ({
		id: layer.id,
		parentId: layer.parentId,
		label: layer.name,
		locked: layer.locked,
		disabled: false
	}));
}

export function sortableNodesFromSceneGraph(graph: Pick<SceneGraph, 'nodes'>): Array<SortableTreeNode> {
	return sortableNodesFromLayers(Array.from(graph.nodes.values(), node => ({
		id: node.id,
		parentId: node.parentId,
		name: node.name,
		locked: node.locked,
		visible: node.visible
	})));
}

export function visibleSortableTreeIds(
	nodes: ReadonlyArray<SortableTreeNode>,
	expandedIds: ReadonlySet<string>
): Array<string> {
	const children = new Map<string | null, Array<SortableTreeNode>>();
	for (const node of nodes) {
		const siblings = children.get(node.parentId) ?? [];
		siblings.push(node);
		children.set(node.parentId, siblings);
	}
	const visible: Array<string> = [];
	const append = (parentId: string | null): void => {
		const childNodes = children.get(parentId) ?? [];
		for (const node of childNodes) {
			visible.push(node.id);
			if (expandedIds.has(node.id)) {
				append(node.id);
			}
		}
	};
	append(null);
	return visible;
}

export function getPointerTreeMove(
	nodes: ReadonlyArray<SortableTreeNode>,
	expandedIds: ReadonlySet<string>,
	sourceIndex: number,
	targetIndex: number,
	clientY: number,
	targetTop: number,
	targetHeight: number
): SortableTreeChangeDetails | null {
	const visibleIds = visibleSortableTreeIds(nodes, expandedIds);
	const sourceId = visibleIds[sourceIndex];
	const targetId = visibleIds[targetIndex];
	if (!sourceId || !targetId || sourceId === targetId || targetHeight <= 0) {
		return null;
	}
	const offset = (clientY - targetTop) / targetHeight;
	let position: SortableTreeChangeDetails['position'];
	if (offset < 1 / 3) {
		position = 'before';
	} else if (offset > 2 / 3) {
		position = 'after';
	} else {
		position = 'inside';
	}
	return { sourceId, targetId, position, input: 'pointer' };
}

export function applySortableTreeChange(
	document: EditorDocument,
	change: Pick<SortableTreeChangeDetails, 'sourceId' | 'targetId' | 'position'>
): EditorDocument {
	return moveLayer(document, change.sourceId, change.targetId, change.position);
}
