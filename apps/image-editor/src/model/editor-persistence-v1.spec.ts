import { describe, expect, it } from 'vitest';
import { deserializePersistenceRoots, recoverPersistenceRoot } from './persistence-v1';
import {
	applyEditorAssetDelta,
	computeEditorAssetDelta,
	DEFAULT_EDITOR_VIEWPORT,
	deduplicateEditorAssets,
	saveEditorPersistence,
	type PersistedEditorAssets
} from './editor-persistence-v1';

const hash = '7ee05b7b7ee83483fe29c5a9092728782f85def146d96c985b40b8385acee722';

const assets = (suffix: string): PersistedEditorAssets => ({
	'image-a': { kind: 'image', dataUrl: `data:image/png;base64,${suffix}` },
	'image-b': { kind: 'image', dataUrl: `data:image/png;base64,${suffix}` },
	'mask-a': { kind: 'mask', dataUrl: 'data:image/png;base64,mask' }
});

describe('editor-persistence-v1', () => {
	it('deduplicates identical asset bytes without changing asset references', () => {
		const deduplicated = deduplicateEditorAssets(assets('same'));
		expect(Object.keys(deduplicated)).toEqual(['image-a', 'image-b', 'mask-a']);
		expect(new Set(Object.values(deduplicated).map(asset => `${asset.kind}:${asset.dataUrl}`)).size).toBe(2);
	});

	it('writes only changed assets in each incremental delta', () => {
		const first = assets('one');
		const second = { ...first, 'image-a': { kind: 'image' as const, dataUrl: 'data:image/png;base64,two' } };
		const delta = computeEditorAssetDelta(first, second);
		expect(delta.removals).toEqual([]);
		expect(delta.upserts).toEqual({ 'image-a': second['image-a'] });
		expect(applyEditorAssetDelta(first, delta)).toEqual(deduplicateEditorAssets(second));
	});

	it('keeps duplicated mask assets independent across save and reopen', () => {
		let serialized: string | null = null;
		const storage = {
			read: () => serialized,
			write: (next: string) => {
				serialized = next;
			}
		};
		const original = {
			'image-a': { kind: 'image' as const, dataUrl: 'data:image/png;base64,image' },
			'mask-original': { kind: 'mask' as const, dataUrl: 'data:image/png;base64,original' },
			'mask-copy': { kind: 'mask' as const, dataUrl: 'data:image/png;base64,copy-before' }
		};
		saveEditorPersistence(storage, {
			documentId: 'editor-document',
			producerTipSetHash: hash,
			rootId: '1'.repeat(64),
			updatedAt: 1,
			input: { document: { maskAssetIds: ['mask-original', 'mask-copy'] }, assets: original }
		});
		const editedCopy = {
			...original,
			'mask-copy': { kind: 'mask' as const, dataUrl: 'data:image/png;base64,copy-after' }
		};
		const saved = saveEditorPersistence(storage, {
			documentId: 'editor-document',
			producerTipSetHash: hash,
			rootId: '2'.repeat(64),
			updatedAt: 2,
			input: { document: { maskAssetIds: ['mask-original', 'mask-copy'] }, assets: editedCopy }
		});

		expect(Object.keys(saved.payload.assets)).toHaveLength(3);
		expect(saved.payload.assets['mask-original']?.dataUrl).toBe('data:image/png;base64,original');
		expect(saved.payload.assets['mask-copy']?.dataUrl).toBe('data:image/png;base64,copy-after');
		expect(computeEditorAssetDelta(original, editedCopy)).toEqual({
			removals: [],
			upserts: { 'mask-copy': editedCopy['mask-copy'] }
		});
	});

	it('garbage-collects assets omitted from the next saved root', () => {
		let serialized: string | null = null;
		const storage = {
			read: () => serialized,
			write: (next: string) => {
				serialized = next;
			}
		};
		const before = {
			'image-live': { kind: 'image' as const, dataUrl: 'data:image/png;base64,image' },
			'mask-deleted': { kind: 'mask' as const, dataUrl: 'data:image/png;base64,deleted' },
			'mask-live': { kind: 'mask' as const, dataUrl: 'data:image/png;base64,live' }
		};
		saveEditorPersistence(storage, {
			documentId: 'editor-document',
			producerTipSetHash: hash,
			rootId: '3'.repeat(64),
			updatedAt: 3,
			input: { document: { assetIds: Object.keys(before) }, assets: before }
		});
		const live = {
			'image-live': before['image-live'],
			'mask-live': before['mask-live']
		};
		const saved = saveEditorPersistence(storage, {
			documentId: 'editor-document',
			producerTipSetHash: hash,
			rootId: '4'.repeat(64),
			updatedAt: 4,
			input: { document: { assetIds: Object.keys(live) }, assets: live }
		});

		expect(Object.keys(saved.payload.assets)).toEqual(['image-live', 'mask-live']);
		expect(computeEditorAssetDelta(before, live)).toEqual({
			removals: ['mask-deleted'],
			upserts: {}
		});
	});

	it('retains the last recoverable root across all 100 deterministic save seeds', () => {
		for (let seed = 0; seed < 100; seed++) {
			let serialized: string | null = null;
			const storage = {
				read: () => serialized,
				write: (next: string) => {
					serialized = next;
				}
			};
			const saved = saveEditorPersistence(storage, {
				documentId: 'editor-document',
				producerTipSetHash: hash,
				rootId: `${seed.toString(16).padStart(2, '0')}${'a'.repeat(62)}`,
				updatedAt: seed,
				input: {
					document: { seed },
					assets: assets(`seed-${seed}`),
					viewport: { panX: seed - 50, panY: 50 - seed, zoom: 0.25 + seed / 100 }
				}
			});
			expect(saved.commitState).toBe('acknowledged');
			const roots = deserializePersistenceRoots<typeof saved.payload>(serialized ?? '');
			expect(recoverPersistenceRoot(roots, 'editor-document')?.payload.document).toEqual({ seed });
			expect(recoverPersistenceRoot(roots, 'editor-document')?.payload.viewport).toEqual({
				panX: seed - 50,
				panY: 50 - seed,
				zoom: 0.25 + seed / 100
			});
			expect(() => recoverPersistenceRoot(roots, 'editor-document')).not.toThrow();
		}
	});

	it('uses a stable viewport default for existing callers', () => {
		let serialized: string | null = null;
		const saved = saveEditorPersistence(
			{
				read: () => serialized,
				write: next => {
					serialized = next;
				}
			},
			{
				documentId: 'editor-document',
				producerTipSetHash: hash,
				rootId: 'b'.repeat(64),
				updatedAt: 1,
				input: { document: { seed: 1 }, assets: assets('default') }
			}
		);
		expect(saved.payload.viewport).toEqual(DEFAULT_EDITOR_VIEWPORT);
	});

	it('rejects invalid viewport values without touching durable storage', () => {
		let serialized = 'prior-root';
		const storage = {
			read: () => serialized,
			write: (next: string) => {
				serialized = next;
			}
		};
		expect(() => saveEditorPersistence(storage, {
			documentId: 'editor-document',
			producerTipSetHash: hash,
			rootId: 'c'.repeat(64),
			updatedAt: 2,
			input: { document: { seed: 2 }, assets: assets('invalid'), viewport: { panX: 0, panY: 0, zoom: 0 } }
		})).toThrow('E_PERSISTENCE_MIGRATION');
		expect(serialized).toBe('prior-root');
	});

	it('classifies storage read failures without writing a replacement root', () => {
		let writes = 0;
		const storage = {
			read: () => {
				throw new Error('storage unavailable');
			},
			write: () => {
				writes += 1;
			}
		};

		expect(() => saveEditorPersistence(storage, {
			documentId: 'editor-document',
			producerTipSetHash: hash,
			rootId: 'd'.repeat(64),
			updatedAt: 3,
			input: { document: { seed: 3 }, assets: assets('read-failure') }
		})).toThrow('E_PERSISTENCE_MIGRATION');
		expect(writes).toBe(0);
	});

	it('rejects malformed assets with a typed non-destructive failure', () => {
		let writes = 0;
		const storage = {
			read: () => null,
			write: () => {
				writes += 1;
			}
		};
		expect(() => saveEditorPersistence(storage, {
			documentId: 'editor-document',
			producerTipSetHash: hash,
			rootId: 'e'.repeat(64),
			updatedAt: 4,
			input: {
				document: { seed: 4 },
				assets: { invalid: { kind: 1 } } as unknown as PersistedEditorAssets
			}
		})).toThrow('E_PERSISTENCE_MIGRATION');
		expect(writes).toBe(0);
	});
});
