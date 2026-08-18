import { describe, expect, it } from 'vitest';
import { createEditorDocument, DocumentHistory, selectLayer, updateLayer } from './editor-document';
import {
	EditorWorkingDocument,
	EDITOR_PRODUCER_TIP_SET_HASH,
	EDITOR_WORKING_DOCUMENT_ID,
	getEditorPersistenceRecoveryState,
	prepareBinaryEditorPersistence,
	restoreBinaryEditorPersistence,
	writePreparedBinaryEditorPersistence,
	waitForIndexedDatabaseTransaction
} from './editor-working-document';
import {
	classifyPersistenceFailure,
	deserializePersistenceRoots,
	recoverPersistenceRoot,
	serializePersistenceRoots,
	type AsyncPersistenceStorage,
	type PersistenceRoot
} from './persistence-v1';

class MemoryAsyncStorage implements AsyncPersistenceStorage {
	serialized: string | null = null;
	writes = 0;
	failWrite = 0;

	async read(): Promise<string | null> {
		return this.serialized;
	}

	async write(serialized: string): Promise<void> {
		this.writes += 1;
		if (this.writes === this.failWrite) {
			const error = new Error('full');
			Object.defineProperty(error, 'name', { value: 'QuotaExceededError' });
			throw error;
		}
		this.serialized = serialized;
	}
}

describe('EditorWorkingDocument', () => {
	it('migrates the legacy Base64 root to a small binary manifest and reopens view state', async () => {
		const document = selectLayer(createEditorDocument(), 'jade-fan');
		const dataUrl = `data:image/png;base64,${btoa('same bytes')}`;
		const legacy = serializePersistenceRoots([{
			schema: 'open-pencil-persistence-v1',
			producerTipSetHash: EDITOR_PRODUCER_TIP_SET_HASH,
			documentId: EDITOR_WORKING_DOCUMENT_ID,
			rootId: '1'.repeat(64),
			sequence: 0,
			payload: {
				document,
				assets: {
					'image-a': { kind: 'image', dataUrl },
					'image-b': { kind: 'image', dataUrl }
				},
				viewport: { panX: 17, panY: -9, zoom: 1.75 }
			},
			commitState: 'acknowledged',
			updatedAt: 1
		}]);

		const prepared = await prepareBinaryEditorPersistence(legacy);
		expect(prepared.assets.size).toBe(1);
		expect(JSON.stringify(prepared.manifest)).not.toContain('data:image/');
		const restored = await restoreBinaryEditorPersistence(
			prepared.manifest,
			async contentId => prepared.assets.get(contentId)
		);
		const storage: AsyncPersistenceStorage = {
			read: async () => restored,
			write: async () => undefined
		};
		const reopened = await new EditorWorkingDocument(storage).recover();

		expect(reopened?.document.selectedLayerId).toBe('jade-fan');
		expect(reopened?.viewport).toEqual({ panX: 17, panY: -9, zoom: 1.75 });
		expect(reopened?.assets).toEqual({
			'image-a': { kind: 'image', dataUrl },
			'image-b': { kind: 'image', dataUrl }
		});
	});

	it('does not rewrite content-addressed asset bytes when they are unchanged', async () => {
		const serialized = serializePersistenceRoots([{
			schema: 'open-pencil-persistence-v1',
			producerTipSetHash: EDITOR_PRODUCER_TIP_SET_HASH,
			documentId: EDITOR_WORKING_DOCUMENT_ID,
			rootId: '2'.repeat(64),
			sequence: 0,
			payload: {
				document: createEditorDocument(),
				assets: {
					image: { kind: 'image', dataUrl: `data:image/png;base64,${btoa('unchanged')}` }
				},
				viewport: { panX: 0, panY: 0, zoom: 1 }
			},
			commitState: 'acknowledged',
			updatedAt: 1
		}]);
		const prepared = await prepareBinaryEditorPersistence(serialized);
		const records = new Map<string, unknown>();
		let assetPuts = 0;
		const store = {
			get: async (key: string) => records.get(key),
			put: (value: unknown, key: string) => {
				records.set(key, value);
				if (key.startsWith('blob/')) {
					assetPuts += 1;
				}
			}
		};

		expect(await writePreparedBinaryEditorPersistence(store, EDITOR_WORKING_DOCUMENT_ID, prepared)).toBe(1);
		expect(await writePreparedBinaryEditorPersistence(store, EDITOR_WORKING_DOCUMENT_ID, prepared)).toBe(0);
		expect(assetPuts).toBe(1);
	});

	it('repairs a corrupt preexisting content-addressed asset before publishing the manifest', async () => {
		const serialized = serializePersistenceRoots([{
			schema: 'open-pencil-persistence-v1',
			producerTipSetHash: EDITOR_PRODUCER_TIP_SET_HASH,
			documentId: EDITOR_WORKING_DOCUMENT_ID,
			rootId: '4'.repeat(64),
			sequence: 0,
			payload: {
				document: createEditorDocument(),
				assets: {
					image: { kind: 'image', dataUrl: `data:image/png;base64,${btoa('healthy')}` }
				},
				viewport: { panX: 0, panY: 0, zoom: 1 }
			},
			commitState: 'acknowledged',
			updatedAt: 1
		}]);
		const prepared = await prepareBinaryEditorPersistence(serialized);
		const contentId = Array.from(prepared.assets.keys())[0];
		const records = new Map<string, unknown>([[
			`blob/${contentId}`,
			{ schema: 'open-pencil-image-editor-asset-v2', bytes: new ArrayBuffer(0) }
		]]);
		const puts: Array<string> = [];

		expect(await writePreparedBinaryEditorPersistence({
			get: async key => records.get(key),
			put: (value, key) => {
				records.set(key, value);
				puts.push(key);
			}
		}, EDITOR_WORKING_DOCUMENT_ID, prepared)).toBe(1);
		expect(puts).toContain(`blob/${contentId}`);
	});

	it('accepts parameterized and percent-encoded image data URLs', async () => {
		const dataUrl = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E';
		const serialized = serializePersistenceRoots([{
			schema: 'open-pencil-persistence-v1',
			producerTipSetHash: EDITOR_PRODUCER_TIP_SET_HASH,
			documentId: EDITOR_WORKING_DOCUMENT_ID,
			rootId: '5'.repeat(64),
			sequence: 0,
			payload: {
				document: createEditorDocument(),
				assets: { vector: { kind: 'image', dataUrl } },
				viewport: { panX: 0, panY: 0, zoom: 1 }
			},
			commitState: 'acknowledged',
			updatedAt: 1
		}]);

		const prepared = await prepareBinaryEditorPersistence(serialized);
		const restored = deserializePersistenceRoots<{
			document: unknown;
			assets: Record<string, { dataUrl: string }>;
			viewport: unknown;
		}>(await restoreBinaryEditorPersistence(
			prepared.manifest,
			async contentId => prepared.assets.get(contentId)
		));
		expect(restored[0]?.payload.assets.vector?.dataUrl)
			.toMatch(/^data:image\/svg\+xml;charset=utf-8;base64,/u);
	});

	it('decodes percent-encoded binary image octets without UTF-8 coercion', async () => {
		const serialized = serializePersistenceRoots([{
			schema: 'open-pencil-persistence-v1',
			producerTipSetHash: EDITOR_PRODUCER_TIP_SET_HASH,
			documentId: EDITOR_WORKING_DOCUMENT_ID,
			rootId: '6'.repeat(64),
			sequence: 0,
			payload: {
				document: createEditorDocument(),
				assets: { image: { kind: 'image', dataUrl: 'data:image/png,%89PNG%0D%0A%1A%0A' } },
				viewport: { panX: 0, panY: 0, zoom: 1 }
			},
			commitState: 'acknowledged',
			updatedAt: 1
		}]);

		const prepared = await prepareBinaryEditorPersistence(serialized);
		expect(Array.from(prepared.assets.values())[0]?.bytes)
			.toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer);
	});

	it('rejects missing binary bytes with a typed non-destructive migration failure', async () => {
		const serialized = serializePersistenceRoots([{
			schema: 'open-pencil-persistence-v1',
			producerTipSetHash: EDITOR_PRODUCER_TIP_SET_HASH,
			documentId: EDITOR_WORKING_DOCUMENT_ID,
			rootId: '3'.repeat(64),
			sequence: 0,
			payload: {
				document: createEditorDocument(),
				assets: {
					image: { kind: 'image', dataUrl: `data:image/png;base64,${btoa('missing')}` }
				},
				viewport: { panX: 0, panY: 0, zoom: 1 }
			},
			commitState: 'acknowledged',
			updatedAt: 1
		}]);
		const prepared = await prepareBinaryEditorPersistence(serialized);
		const before = JSON.stringify(prepared.manifest);

		await expect(restoreBinaryEditorPersistence(
			prepared.manifest,
			async () => undefined
		)).rejects.toThrow('E_PERSISTENCE_MIGRATION');
		expect(JSON.stringify(prepared.manifest)).toBe(before);
	});

	it('saves and recovers the consuming editor document, assets, and viewport', async () => {
		const storage = new MemoryAsyncStorage();
		const persistence = new EditorWorkingDocument(storage);
		const document = selectLayer(
			updateLayer(createEditorDocument(), 'headline', { name: 'Recovered headline' }),
			'jade-fan'
		);
		const assets = {
			'image': { kind: 'image' as const, dataUrl: 'data:image/png;base64,image' }
		};

		await persistence.save({
			document,
			assets,
			viewport: { panX: 24, panY: -12, zoom: 1.5 }
		});

		const recovered = await new EditorWorkingDocument(storage).recover();
		expect(recovered).toEqual({
			document,
			assets,
			viewport: { panX: 24, panY: -12, zoom: 1.5 }
		});
		const reopened = new DocumentHistory(recovered?.document ?? createEditorDocument());
		expect(reopened.document.selectedLayerId).toBe('jade-fan');
		expect(reopened.canUndo).toBe(false);
		expect(reopened.canRedo).toBe(false);
		expect(storage.writes).toBe(3);
	});

	it('serializes overlapping autosaves and recovers the newest ACK', async () => {
		const storage = new MemoryAsyncStorage();
		const persistence = new EditorWorkingDocument(storage);
		const first = updateLayer(createEditorDocument(), 'headline', { name: 'First' });
		const second = updateLayer(first, 'headline', { name: 'Second' });

		await Promise.all([
			persistence.save({ document: first, assets: {} }),
			persistence.save({ document: second, assets: {} })
		]);

		const recovered = await persistence.recover();
		expect(recovered?.document).toEqual(second);
		expect(storage.writes).toBe(6);
	});

	it('reports quota failure and preserves the prior recoverable root', async () => {
		const storage = new MemoryAsyncStorage();
		const persistence = new EditorWorkingDocument(storage);
		const prior = createEditorDocument();
		await persistence.save({ document: prior, assets: {} });
		storage.failWrite = storage.writes + 1;

		await expect(persistence.save({
			document: updateLayer(prior, 'headline', { name: 'Not durable' }),
			assets: {}
		})).rejects.toThrow('E_PERSISTENCE_QUOTA');

		const recovered = await persistence.recover();
		expect(recovered?.document).toEqual(prior);
	});

	it('retries after a transient quota failure without losing the prior root', async () => {
		const storage = new MemoryAsyncStorage();
		const persistence = new EditorWorkingDocument(storage);
		const prior = createEditorDocument();
		const recoveredName = 'Recovered after quota';
		await persistence.save({ document: prior, assets: {} });
		storage.failWrite = storage.writes + 1;
		await expect(persistence.save({
			document: updateLayer(prior, 'headline', { name: 'Rejected' }),
			assets: {}
		})).rejects.toThrow('E_PERSISTENCE_QUOTA');
		storage.failWrite = 0;
		await persistence.save({
			document: updateLayer(prior, 'headline', { name: recoveredName }),
			assets: {}
		});

		const recovered = await new EditorWorkingDocument(storage).recover();
		expect(recovered?.document.layers.find(layer => layer.id === 'headline')?.name).toBe(recoveredName);
	});

	it('keeps editing blocked during recovery retry and re-enables writes on success', () => {
		expect(getEditorPersistenceRecoveryState('retrying')).toEqual({
			ready: false,
			writable: false,
			status: 'retrying'
		});
		expect(getEditorPersistenceRecoveryState('saved')).toEqual({
			ready: true,
			writable: true,
			status: 'saved'
		});
	});

	it('waits for transaction completion and types a late quota abort', async () => {
		const listeners = new Map<string, Array<EventListenerOrEventListenerObject>>();
		const quota = new Error('late abort');
		Object.defineProperty(quota, 'name', { value: 'QuotaExceededError' });
		const transaction = {
			error: quota,
			addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
				listeners.set(type, [...(listeners.get(type) ?? []), listener]);
			}
		} as unknown as IDBTransaction;
		let settled = false;
		const pending = waitForIndexedDatabaseTransaction(transaction).finally(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		const abortListeners = listeners.get('abort') ?? [];
		for (const listener of abortListeners) {
			if (typeof listener === 'function') {
				listener(new Event('abort'));
			} else {
				listener.handleEvent(new Event('abort'));
			}
		}
		const failure = await pending.catch((error_: unknown) => classifyPersistenceFailure(error_));
		expect(failure).toMatchObject({ code: 'E_PERSISTENCE_QUOTA' });
	});

	it('rejects malformed recovery payload without replacing storage', async () => {
		const storage = new MemoryAsyncStorage();
		const malformed: PersistenceRoot<unknown> = {
			schema: 'open-pencil-persistence-v1',
			producerTipSetHash: 'a'.repeat(64),
			documentId: EDITOR_WORKING_DOCUMENT_ID,
			rootId: 'b'.repeat(64),
			sequence: 0,
			payload: { document: createEditorDocument(), assets: { bad: { kind: 1 } }, viewport: { panX: 0, panY: 0, zoom: 1 } },
			commitState: 'acknowledged',
			updatedAt: 1
		};
		storage.serialized = serializePersistenceRoots([malformed]);
		const before = storage.serialized;

		await expect(new EditorWorkingDocument(storage).recover()).rejects.toThrow('E_PERSISTENCE_MIGRATION');
		expect(storage.serialized).toBe(before);
		expect(recoverPersistenceRoot(deserializePersistenceRoots(storage.serialized), EDITOR_WORKING_DOCUMENT_ID))
			.toBeDefined();
	});

	it('rejects another producer tip set without replacing storage', async () => {
		const storage = new MemoryAsyncStorage();
		const incompatible: PersistenceRoot<unknown> = {
			schema: 'open-pencil-persistence-v1',
			producerTipSetHash: '0'.repeat(64),
			documentId: EDITOR_WORKING_DOCUMENT_ID,
			rootId: 'b'.repeat(64),
			sequence: 0,
			payload: { document: createEditorDocument(), assets: {}, viewport: { panX: 0, panY: 0, zoom: 1 } },
			commitState: 'acknowledged',
			updatedAt: 1
		};
		storage.serialized = serializePersistenceRoots([incompatible]);
		const before = storage.serialized;

		expect(incompatible.producerTipSetHash).not.toBe(EDITOR_PRODUCER_TIP_SET_HASH);
		await expect(new EditorWorkingDocument(storage).recover()).rejects.toMatchObject({
			code: 'E_PERSISTENCE_MIGRATION'
		});
		expect(storage.serialized).toBe(before);
	});
});
