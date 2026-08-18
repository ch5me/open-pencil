import { describe, expect, it } from 'vitest';
import {
	collectHistoryAssetGarbage,
	duplicateLayerWithAssets,
	type EditorAssetLifecycle
} from './editor-asset-lifecycle';
import {
	DocumentHistory,
	createEditorDocument,
	deleteLayer,
	documentCommand,
	findLayer,
	updateLayer
} from './editor-document';

class FakeAssets implements EditorAssetLifecycle {
	readonly values = new Map<string, string>();
	private nextId = 1;

	duplicateAsset(id: string): string {
		const value = this.values.get(id);
		if (!value) {
			throw new Error(`Unknown editor asset: ${id}`);
		}
		const copyId = `${id}-copy-${this.nextId++}`;
		this.values.set(copyId, value);
		return copyId;
	}

	removeAsset(id: string): void {
		this.values.delete(id);
	}

	collectGarbage(referencedIds: Iterable<string>): ReadonlyArray<string> {
		const referenced = new Set(referencedIds);
		const released: Array<string> = [];
		for (const id of this.values.keys()) {
			if (referenced.has(id)) {
				continue;
			}
			this.values.delete(id);
			released.push(id);
		}
		return released;
	}
}

describe('editor asset lifecycle', () => {
	it('duplicates mask bytes independently across undo and redo', () => {
		const assets = new FakeAssets();
		assets.values.set('asset:image:jade', 'image');
		assets.values.set('asset:mask:jade', 'original-mask');
		const source = updateLayer(createEditorDocument(), 'jade-fan', {
			assetId: 'asset:image:jade',
			maskEnabled: true,
			maskAssetId: 'asset:mask:jade'
		});
		const history = new DocumentHistory(source);

		const duplicated = duplicateLayerWithAssets(source, 'jade-fan', assets);
		history.execute(documentCommand('Duplicate layer', source, duplicated.document));
		collectHistoryAssetGarbage(history, assets);
		const copy = findLayer(duplicated.document, duplicated.selectedLayerId);
		expect(copy?.maskAssetId).not.toBe('asset:mask:jade');
		expect(assets.values.get(copy?.maskAssetId ?? '')).toBe('original-mask');

		assets.values.set(copy?.maskAssetId ?? '', 'edited-copy-mask');
		expect(assets.values.get('asset:mask:jade')).toBe('original-mask');

		history.undo();
		collectHistoryAssetGarbage(history, assets);
		expect(assets.values.has(copy?.maskAssetId ?? '')).toBe(true);
		history.redo();
		collectHistoryAssetGarbage(history, assets);
		expect(findLayer(history.document, duplicated.selectedLayerId)?.maskAssetId).toBe(copy?.maskAssetId);
		expect([...assets.values]).toEqual([
			['asset:image:jade', 'image'],
			['asset:mask:jade', 'original-mask'],
			[copy?.maskAssetId, 'edited-copy-mask']
		]);
	});

	it('releases duplicated masks when undo is followed by a new branch', () => {
		const assets = new FakeAssets();
		assets.values.set('asset:mask:jade', 'original-mask');
		const source = updateLayer(createEditorDocument(), 'jade-fan', {
			maskEnabled: true,
			maskAssetId: 'asset:mask:jade'
		});
		const history = new DocumentHistory(source);
		const duplicated = duplicateLayerWithAssets(source, 'jade-fan', assets);
		const duplicateMaskAssetId = findLayer(
			duplicated.document,
			duplicated.selectedLayerId
		)?.maskAssetId;
		history.execute(documentCommand('Duplicate layer', source, duplicated.document));
		history.undo();
		const branch = updateLayer(history.document, 'jade-fan', { opacity: 0.5 });
		history.execute(documentCommand('Change opacity', history.document, branch));

		expect(collectHistoryAssetGarbage(history, assets)).toEqual([duplicateMaskAssetId]);
		expect([...assets.values]).toEqual([['asset:mask:jade', 'original-mask']]);
	});

	it('retains deleted assets while the document remains undoable', () => {
		const assets = new FakeAssets();
		assets.values.set('asset:image:jade', 'image');
		assets.values.set('asset:mask:jade', 'mask');
		const source = updateLayer(createEditorDocument(), 'jade-fan', {
			assetId: 'asset:image:jade',
			maskEnabled: true,
			maskAssetId: 'asset:mask:jade'
		});
		const history = new DocumentHistory(source);
		const deleted = deleteLayer(source, 'jade-fan');
		history.execute(documentCommand('Delete layer', source, deleted));

		expect(collectHistoryAssetGarbage(history, assets)).toEqual([]);
		history.undo();
		expect(findLayer(history.document, 'jade-fan')).toBeDefined();
		expect(collectHistoryAssetGarbage(history, assets)).toEqual([]);
	});

	it('rolls back duplicated assets when a later subtree mask cannot be copied', () => {
		const assets = new FakeAssets();
		assets.values.set('asset:mask:group', 'group-mask');
		const source = updateLayer(createEditorDocument(), 'artwork', {
			maskEnabled: true,
			maskAssetId: 'asset:mask:group'
		});
		const child = updateLayer(source, 'jade-fan', {
			maskEnabled: true,
			maskAssetId: 'asset:mask:missing'
		});

		expect(() => duplicateLayerWithAssets(child, 'artwork', assets)).toThrow(
			'Unknown editor asset: asset:mask:missing'
		);
		expect([...assets.values]).toEqual([['asset:mask:group', 'group-mask']]);
	});

	it('duplicates every masked layer in a group subtree', () => {
		const assets = new FakeAssets();
		assets.values.set('asset:mask:group', 'group-mask');
		assets.values.set('asset:mask:child', 'child-mask');
		const source = updateLayer(
			updateLayer(createEditorDocument(), 'artwork', {
				maskEnabled: true,
				maskAssetId: 'asset:mask:group'
			}),
			'jade-fan',
			{
				maskEnabled: true,
				maskAssetId: 'asset:mask:child'
			}
		);

		const duplicated = duplicateLayerWithAssets(source, 'artwork', assets).document;
		const groupMask = findLayer(duplicated, 'artwork-copy')?.maskAssetId;
		const childMask = findLayer(duplicated, 'jade-fan-copy')?.maskAssetId;
		expect(groupMask).not.toBe('asset:mask:group');
		expect(childMask).not.toBe('asset:mask:child');
		expect(assets.values.get(groupMask ?? '')).toBe('group-mask');
		expect(assets.values.get(childMask ?? '')).toBe('child-mask');
	});
});
