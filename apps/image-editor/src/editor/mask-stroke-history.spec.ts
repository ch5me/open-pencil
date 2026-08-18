import { describe, expect, it } from 'vitest';
import {
	DocumentHistory,
	createEditorDocument,
	deleteLayer,
	documentCommand,
	executeLayerSelection,
	findLayer,
	updateLayer,
	type EditorDocument
} from '../model/editor-document';
import {
	collectHistoryAssetGarbage,
	duplicateLayerWithAssets,
	type EditorAssetLifecycle
} from '../model/editor-asset-lifecycle';
import type { EditorMaskSnapshot } from '../rendering/editor-asset-registry';
import { MaskStrokeHistory } from './mask-stroke-history';

const BEFORE = [255, 255, 255, 255, 255, 255, 255, 255];
const ERASED = [0, 0, 0, 0, 255, 255, 255, 255];
const REVEALED = [0, 0, 0, 0, 17, 34, 51, 68];

class FakeAssets implements EditorAssetLifecycle {
	readonly values = new Map<string, Uint8ClampedArray>();
	restoreFailure: Error | null = null;

	snapshotMask(id: string): EditorMaskSnapshot {
		const bytes = this.values.get(id);
		if (!bytes) {
			throw new Error(`Unknown editor mask asset: ${id}`);
		}
		return { id, width: 2, height: 1, bytes: bytes.slice() };
	}

	restoreMask(snapshot: EditorMaskSnapshot): void {
		if (this.restoreFailure) {
			throw this.restoreFailure;
		}
		if (!this.values.has(snapshot.id)) {
			throw new Error(`Unknown editor mask asset: ${snapshot.id}`);
		}
		this.values.set(snapshot.id, snapshot.bytes.slice());
	}

	duplicateAsset(id: string): string {
		const copy = `${id}:copy`;
		this.values.set(copy, this.snapshotMask(id).bytes);
		return copy;
	}

	removeAsset(id: string): void {
		this.values.delete(id);
	}

	collectGarbage(referencedIds: Iterable<string>): ReadonlyArray<string> {
		const retained = new Set(referencedIds);
		const removed: Array<string> = [];
		for (const id of this.values.keys()) {
			if (retained.has(id)) {
				continue;
			}
			this.values.delete(id);
			removed.push(id);
		}
		return removed;
	}
}

function fixture() {
	const assets = new FakeAssets();
	assets.values.set('mask:jade', new Uint8ClampedArray(BEFORE));
	const document = updateLayer(createEditorDocument(), 'jade-fan', {
		maskEnabled: true,
		maskAssetId: 'mask:jade'
	});
	const history = new DocumentHistory(document);
	const strokes = new MaskStrokeHistory(assets);
	const paint = (rgba: ReadonlyArray<number>) => assets.values.set('mask:jade', new Uint8ClampedArray(rgba));
	const pixels = () => [...(assets.values.get('mask:jade') ?? [])];
	return { assets, document, history, strokes, paint, pixels };
}

function beginAndPaint(
	strokes: MaskStrokeHistory,
	document: EditorDocument,
	paint: (rgba: ReadonlyArray<number>) => void,
	pointerId: number,
	rgba: ReadonlyArray<number>
) {
	expect(strokes.start(pointerId, document, 'jade-fan', 'mask:jade')).toBe('started');
	paint(rgba);
	strokes.markPainted(pointerId, true);
}

describe('pointer mask stroke history', () => {
	it('undoes and redoes exact RGBA while keeping the mask enabled', () => {
		const { history, strokes, document, paint, pixels } = fixture();
		beginAndPaint(strokes, document, paint, 1, ERASED);
		expect(strokes.finish(1, history)).toBe(true);
		expect(pixels()).toEqual(ERASED);

		history.undo();
		expect(pixels()).toEqual(BEFORE);
		expect(findLayer(history.document, 'jade-fan')).toMatchObject({ maskEnabled: true, maskAssetId: 'mask:jade' });
		history.redo();
		expect(pixels()).toEqual(ERASED);
	});

	it('clears redo when a new pointer stroke commits', () => {
		const { history, strokes, document, paint, pixels } = fixture();
		beginAndPaint(strokes, document, paint, 1, ERASED);
		strokes.finish(1, history);
		history.undo();
		expect(history.canRedo).toBe(true);

		beginAndPaint(strokes, history.document, paint, 2, REVEALED);
		strokes.finish(2, history);
		expect(history.canRedo).toBe(false);
		expect(pixels()).toEqual(REVEALED);
	});

	it('finalizes before undo, selection, delete, load, and garbage collection', () => {
		const { assets, history, strokes, document, paint, pixels } = fixture();
		beginAndPaint(strokes, document, paint, 1, ERASED);
		strokes.finalize(history);
		history.undo();
		expect(pixels()).toEqual(BEFORE);

		beginAndPaint(strokes, history.document, paint, 2, REVEALED);
		strokes.finalize(history);
		executeLayerSelection(history, 'headline');
		expect(history.document.selectedLayerId).toBe('headline');
		expect(pixels()).toEqual(REVEALED);

		beginAndPaint(strokes, history.document, paint, 3, ERASED);
		strokes.finalize(history);
		const beforeDelete = history.document;
		history.execute(documentCommand('Delete layer', beforeDelete, deleteLayer(beforeDelete, 'jade-fan')));
		expect(collectHistoryAssetGarbage(history, assets)).toEqual([]);

		history.undo();
		beginAndPaint(strokes, history.document, paint, 4, REVEALED);
		expect(strokes.cancel()).toBe(true);
		history.reset(createEditorDocument());
		expect(pixels()).toEqual(ERASED);
	});

	it('coalesces one pointer and cancels the stroke when a second pointer arrives', () => {
		const { history, strokes, document, paint, pixels } = fixture();
		beginAndPaint(strokes, document, paint, 7, ERASED);
		expect(strokes.start(7, document, 'jade-fan', 'mask:jade')).toBe('coalesced');
		paint(REVEALED);
		strokes.markPainted(7, true);
		expect(strokes.start(8, document, 'jade-fan', 'mask:jade')).toBe('cancelled');
		expect(pixels()).toEqual(BEFORE);
		expect(strokes.finish(7, history)).toBe(false);
		expect(history.canUndo).toBe(false);
	});

	it('keeps paint bound to the pointer-down layer and asset', () => {
		const { strokes, document } = fixture();
		expect(strokes.start(5, document, 'jade-fan', 'mask:jade')).toBe('started');
		const binding = strokes.binding(5);
		expect(binding?.assetId).toBe('mask:jade');
		expect(binding?.layer.id).toBe('jade-fan');
		expect(strokes.binding(6)).toBeNull();
	});

	it('rejects stale ownership without capturing a stroke', () => {
		const { history, strokes, document } = fixture();
		expect(strokes.start(1, document, 'headline', 'mask:jade')).toBe('rejected');
		expect(strokes.finish(1, history)).toBe(false);
		expect(history.canUndo).toBe(false);
	});

	it('does not clear redo for an exact RGBA no-op stroke', () => {
		const { history, strokes, document, paint } = fixture();
		const changed = updateLayer(document, 'headline', { name: 'Changed' });
		history.execute(documentCommand('Change', document, changed));
		history.undo();
		expect(history.canRedo).toBe(true);

		beginAndPaint(strokes, history.document, paint, 3, BEFORE);
		expect(strokes.finish(3, history)).toBe(false);
		expect(history.canRedo).toBe(true);
	});

	it('cancels pointercancel bytes without creating history', () => {
		const { history, strokes, document, paint, pixels } = fixture();
		beginAndPaint(strokes, document, paint, 9, ERASED);
		expect(strokes.cancel(9)).toBe(true);
		expect(pixels()).toEqual(BEFORE);
		expect(history.canUndo).toBe(false);
	});

	it('propagates the exact restore failure instead of reporting a cancelled stroke', () => {
		const { assets, history, strokes, document, paint, pixels } = fixture();
		const failure = new Error('RGBA restore failed');
		beginAndPaint(strokes, document, paint, 9, ERASED);
		assets.restoreFailure = failure;

		let caught: unknown;
		try {
			strokes.cancel(9);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBe(failure);
		expect(pixels()).toEqual(ERASED);
		expect(strokes.finish(9, history)).toBe(false);
		expect(history.canUndo).toBe(false);
	});

	it('finalizes exact active-stroke bytes before duplicate-failure garbage collection', () => {
		const { assets, history, strokes, document } = fixture();
		assets.values.set('mask:group', new Uint8ClampedArray(BEFORE));
		const source = updateLayer(
			updateLayer(document, 'artwork', {
				maskEnabled: true,
				maskAssetId: 'mask:group'
			}),
			'jade-fan',
			{
				maskEnabled: true,
				maskAssetId: 'mask:missing'
			}
		);
		history.reset(source);
		expect(strokes.start(12, source, 'artwork', 'mask:group')).toBe('started');
		assets.values.set('mask:group', new Uint8ClampedArray(ERASED));
		strokes.markPainted(12, true);

		expect(() => duplicateLayerWithAssets(source, 'artwork', assets)).toThrow(
			'Unknown editor mask asset: mask:missing'
		);
		expect(strokes.finalize(history)).toBe(true);
		expect(collectHistoryAssetGarbage(history, assets)).toEqual(['mask:jade']);
		// Iterator helpers are outside this package's configured TypeScript libs.
		// eslint-disable-next-line unicorn/prefer-iterator-to-array
		expect([...assets.values.keys()]).toEqual(['mask:group']);
		expect([...(assets.values.get('mask:group') ?? [])]).toEqual(ERASED);

		history.undo();
		expect([...(assets.values.get('mask:group') ?? [])]).toEqual(BEFORE);
		history.redo();
		expect([...(assets.values.get('mask:group') ?? [])]).toEqual(ERASED);
	});

	it('cancels an active pointer before a keyboard stroke owns exact RGBA', () => {
		const { history, strokes, document, paint, pixels } = fixture();
		beginAndPaint(strokes, document, paint, 4, ERASED);
		expect(strokes.cancel()).toBe(true);
		expect(pixels()).toEqual(BEFORE);

		beginAndPaint(strokes, document, paint, -1, REVEALED);
		expect(strokes.finish(-1, history)).toBe(true);
		strokes.markPainted(4, true);
		expect(strokes.finish(4, history)).toBe(false);
		expect(pixels()).toEqual(REVEALED);

		history.undo();
		expect(pixels()).toEqual(BEFORE);
	});
});
