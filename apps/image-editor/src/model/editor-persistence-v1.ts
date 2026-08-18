import {
	deserializePersistenceRoots,
	migratePersistenceRoot,
	migratePersistenceRootAsync,
	PersistenceError,
	recoverPersistenceRoot,
	type AsyncPersistenceStorage,
	type PersistenceRoot,
	type PersistenceStorage
} from './persistence-v1';

export interface EditorViewport {
	readonly panX: number;
	readonly panY: number;
	readonly zoom: number;
}

export const DEFAULT_EDITOR_VIEWPORT: EditorViewport = {
	panX: 0,
	panY: 0,
	zoom: 1
};

export interface PersistedEditorAsset {
	readonly kind: 'image' | 'mask';
	readonly dataUrl: string;
}

export type PersistedEditorAssets = Readonly<Record<string, PersistedEditorAsset>>;

export interface EditorPersistencePayload<T> {
	readonly document: T;
	readonly assets: PersistedEditorAssets;
	readonly viewport: EditorViewport;
}

export interface EditorAssetDelta {
	readonly upserts: PersistedEditorAssets;
	readonly removals: ReadonlyArray<string>;
}

export interface EditorPersistenceInput<T> {
	readonly document: T;
	readonly assets: PersistedEditorAssets;
	readonly viewport?: EditorViewport;
}

export interface EditorPersistenceMigration<T> {
	readonly documentId: string;
	readonly producerTipSetHash: string;
	readonly rootId: string;
	readonly updatedAt: number;
	readonly input: EditorPersistenceInput<T>;
}

export function validateEditorViewport(viewport: EditorViewport): void {
	if (
		!Number.isFinite(viewport.panX) ||
		!Number.isFinite(viewport.panY) ||
		!Number.isFinite(viewport.zoom) ||
		viewport.zoom <= 0
	) {
		throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid editor viewport');
	}
}

function editorViewportOrDefault(viewport: EditorViewport | undefined): EditorViewport {
	const value = viewport ?? DEFAULT_EDITOR_VIEWPORT;
	validateEditorViewport(value);
	return { panX: value.panX, panY: value.panY, zoom: value.zoom };
}

export function deduplicateEditorAssets(assets: PersistedEditorAssets): PersistedEditorAssets {
	validatePersistedEditorAssets(assets);
	const canonicalByValue = new Map<string, string>();
	const result: Record<string, PersistedEditorAsset> = {};
	for (const [id, asset] of Object.entries(assets)) {
		const key = `${asset.kind}\u{0}${asset.dataUrl}`;
		const canonicalId = canonicalByValue.get(key);
		if (canonicalId) {
			result[id] = result[canonicalId]!;
			continue;
		}
		canonicalByValue.set(key, id);
		result[id] = asset;
	}
	return result;
}

export function validatePersistedEditorAssets(value: unknown): asserts value is PersistedEditorAssets {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid editor assets');
	}
	for (const [id, asset] of Object.entries(value)) {
		if (id.length === 0) {
			throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid editor asset');
		}
		if (
			asset === null ||
			typeof asset !== 'object' ||
			!('kind' in asset) ||
			(asset.kind !== 'image' && asset.kind !== 'mask') ||
			!('dataUrl' in asset) ||
			typeof asset.dataUrl !== 'string' ||
			!asset.dataUrl.startsWith('data:image/')
		) {
			throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid editor asset');
		}
	}
}

export function computeEditorAssetDelta(
	previous: PersistedEditorAssets,
	next: PersistedEditorAssets
): EditorAssetDelta {
	const deduplicated = deduplicateEditorAssets(next);
	const upserts: Record<string, PersistedEditorAsset> = {};
	for (const [id, asset] of Object.entries(deduplicated)) {
		const prior = previous[id];
		if (!prior || prior.kind !== asset.kind || prior.dataUrl !== asset.dataUrl) {
			upserts[id] = asset;
		}
	}
	const removals = Object.keys(previous).filter(id => !(id in deduplicated));
	return { upserts, removals };
}

export function applyEditorAssetDelta(
	previous: PersistedEditorAssets,
	delta: EditorAssetDelta
): PersistedEditorAssets {
	const next: Record<string, PersistedEditorAsset> = { ...previous };
	for (const id of delta.removals) {
		delete next[id];
	}
	Object.assign(next, delta.upserts);
	return deduplicateEditorAssets(next);
}

export function saveEditorPersistence<T>(
	storage: PersistenceStorage,
	migration: EditorPersistenceMigration<T>
): PersistenceRoot<EditorPersistencePayload<T>> {
	let previous: PersistenceRoot<EditorPersistencePayload<T>> | undefined;
	try {
		const existing = storage.read();
		previous = existing ?
			recoverPersistenceRoot<EditorPersistencePayload<T>>(
				deserializePersistenceRoots<EditorPersistencePayload<T>>(existing),
				migration.documentId
			) :
			undefined;
	} catch (error) {
		if (error instanceof PersistenceError) {
			throw error;
		}
		throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'persistence read failed');
	}
	const assets = deduplicateEditorAssets(migration.input.assets);
	const viewport = editorViewportOrDefault(migration.input.viewport);
	return migratePersistenceRoot(storage, {
		documentId: migration.documentId,
		producerTipSetHash: migration.producerTipSetHash,
		rootId: migration.rootId,
		updatedAt: migration.updatedAt,
		payload: {
			document: migration.input.document,
			assets: previous ? applyEditorAssetDelta(previous.payload.assets, computeEditorAssetDelta(previous.payload.assets, assets)) : assets,
			viewport
		}
	});
}

export async function saveEditorPersistenceAsync<T>(
	storage: AsyncPersistenceStorage,
	migration: EditorPersistenceMigration<T>
): Promise<PersistenceRoot<EditorPersistencePayload<T>>> {
	let previous: PersistenceRoot<EditorPersistencePayload<T>> | undefined;
	try {
		const existing = await storage.read();
		previous = existing ?
			recoverPersistenceRoot<EditorPersistencePayload<T>>(
				deserializePersistenceRoots<EditorPersistencePayload<T>>(existing),
				migration.documentId
			) :
			undefined;
	} catch (error) {
		throw error instanceof PersistenceError ?
			error :
			new PersistenceError('E_PERSISTENCE_MIGRATION', 'persistence read failed');
	}
	const assets = deduplicateEditorAssets(migration.input.assets);
	const viewport = editorViewportOrDefault(migration.input.viewport);
	return migratePersistenceRootAsync(storage, {
		documentId: migration.documentId,
		producerTipSetHash: migration.producerTipSetHash,
		rootId: migration.rootId,
		updatedAt: migration.updatedAt,
		payload: {
			document: migration.input.document,
			assets: previous ? applyEditorAssetDelta(previous.payload.assets, computeEditorAssetDelta(previous.payload.assets, assets)) : assets,
			viewport
		}
	});
}
