import { describe, expect, it } from 'vitest';
import type { SceneNode } from '@open-pencil/scene-graph';
import {
	applySortableTreeChange,
	GEOMETRY_CONTROLS,
	sortableNodesFromLayers,
	sortableNodesFromSceneGraph,
	updateGeometryControl,
	getPointerTreeMove,
	visibleSortableTreeIds
} from './producer-compatibility';
import { createEditorDocument, findLayer } from '../model/editor-document';

function sceneNode(
	id: string,
	name: string,
	parentId: string | null,
	locked: boolean,
	visible: boolean
): SceneNode {
	return { id, name, parentId, locked, visible } as SceneNode;
}

describe('producer compatibility projection', () => {
	it('preserves scene order and maps tree state', () => {
		const nodes = new Map<string, SceneNode>([
			['group', sceneNode('group', 'Group', null, true, true)],
			['layer', sceneNode('layer', 'Layer', 'group', false, false)]
		]);

		expect(sortableNodesFromSceneGraph({ nodes })).toEqual([
			{ id: 'group', parentId: null, label: 'Group', locked: true, disabled: false },
			{ id: 'layer', parentId: 'group', label: 'Layer', locked: false, disabled: false }
		]);
	});

	it('projects consumer layers without duplicating producer tree mapping', () => {
		expect(sortableNodesFromLayers([
			{ id: 'group', parentId: null, name: 'Group', locked: true, visible: true },
			{ id: 'layer', parentId: 'group', name: 'Layer', locked: false, visible: false }
		])).toEqual([
			{ id: 'group', parentId: null, label: 'Group', locked: true, disabled: false },
			{ id: 'layer', parentId: 'group', label: 'Layer', locked: false, disabled: false }
		]);
	});

	it('round-trips geometry-v1 numeric controls', () => {
		const start = {
			bounds: { x: 100, y: 80, width: 200, height: 100 },
			rotation: 12
		};

		const result = updateGeometryControl(start, 'x', 0);
		let updated = start;
		for (const control of GEOMETRY_CONTROLS) {
			updated = updateGeometryControl(updated, control.key, control.key === 'rotation' ? 45 : 320);
		}

		expect(result).toEqual({ bounds: { x: 0, y: 80, width: 200, height: 100 }, rotation: 12 });
		expect(updated).toEqual({ bounds: { x: 320, y: 320, width: 320, height: 320 }, rotation: 45 });
	});

	it('rejects non-finite and out-of-range geometry values', () => {
		expect(() => updateGeometryControl({ bounds: { x: 0, y: 0, width: 24, height: 24 }, rotation: 0 }, 'width', 0)).toThrow('Invalid width geometry value');
		expect(() => updateGeometryControl({ bounds: { x: 0, y: 0, width: 24, height: 24 }, rotation: 0 }, 'rotation', 361)).toThrow('Invalid rotation geometry value');
		expect(() => updateGeometryControl({ bounds: { x: 0, y: 0, width: 24, height: 24 }, rotation: 0 }, 'x', Number.NaN)).toThrow('Invalid x geometry value');
		expect(() => updateGeometryControl({ bounds: { x: 0, y: 0, width: 24, height: 24 }, rotation: 0 }, 'x', '')).toThrow('Invalid x geometry value');
	});

	it('maps touch tree coordinates to before, inside, and after moves', () => {
		const nodes = [
			{ id: 'group', parentId: null, label: 'Group' },
			{ id: 'child', parentId: 'group', label: 'Child' },
			{ id: 'sibling', parentId: null, label: 'Sibling' }
		];
		const expanded = new Set(['group']);
		expect(visibleSortableTreeIds(nodes, expanded)).toEqual(['group', 'child', 'sibling']);
		expect(getPointerTreeMove(nodes, expanded, 2, 0, 9, 0, 30)).toMatchObject({
			sourceId: 'sibling',
			targetId: 'group',
			position: 'before',
			input: 'pointer'
		});
		expect(getPointerTreeMove(nodes, expanded, 2, 0, 15, 0, 30)?.position).toBe('inside');
		expect(getPointerTreeMove(nodes, expanded, 2, 0, 29, 0, 30)?.position).toBe('after');
		expect(getPointerTreeMove(nodes, expanded, 0, 0, 15, 0, 30)).toBeNull();
	});

	it('applies pointer tree intent without letting the producer own document order', () => {
		const before = createEditorDocument();
		const after = applySortableTreeChange(before, {
			sourceId: 'headline',
			targetId: 'artwork',
			position: 'inside'
		});
		expect(before).not.toBe(after);
		expect(findLayer(before, 'headline')?.parentId).toBeNull();
		expect(findLayer(after, 'headline')?.parentId).toBe('artwork');
		expect(after.selectedLayerId).toBe(before.selectedLayerId);
	});

	it('rejects invalid pointer tree intent without mutating the consumer document', () => {
		const before = createEditorDocument();

		expect(() => applySortableTreeChange(before, {
			sourceId: 'artwork',
			targetId: 'artwork',
			position: 'inside'
		})).toThrow('own subtree');
		expect(findLayer(before, 'artwork')?.parentId).toBeNull();
	});
});
