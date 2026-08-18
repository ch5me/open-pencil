import { parseEditorDocument, type EditorDocument } from './editor-document';
import {
	saveEditorPersistenceAsync,
	validatePersistedEditorAssets,
	validateEditorViewport,
	type EditorPersistenceInput,
	type EditorPersistencePayload,
	type EditorViewport
} from './editor-persistence-v1';
import {
	classifyPersistenceFailure,
	deserializePersistenceRoots,
	PersistenceError,
	recoverPersistenceRoot,
	serializePersistenceRoots,
	type AsyncPersistenceStorage,
	type PersistenceRoot,
	type SerializedPersistenceRoots
} from './persistence-v1';

export const EDITOR_WORKING_DOCUMENT_ID = 'open-pencil-image-editor-working-document';
export const EDITOR_PRODUCER_TIP_SET_HASH = '89dbc26a9b134ded7a7528b06546fba5277b1c63dabc1c01ca4d3265e20741ac';

export type EditorPersistenceRecoveryStatus = 'recovering' | 'retrying' | 'saved' | 'failed';

export interface EditorPersistenceRecoveryState {
	readonly ready: boolean;
	readonly writable: boolean;
	readonly status: EditorPersistenceRecoveryStatus;
}

export function getEditorPersistenceRecoveryState(
	status: EditorPersistenceRecoveryStatus
): EditorPersistenceRecoveryState {
	return {
		ready: status === 'saved' || status === 'failed',
		writable: status === 'saved',
		status
	};
}

const DATABASE_NAME = 'open-pencil-image-editor-v1';
const LEGACY_STORE_NAME = 'working-documents';
const RECORD_STORE_NAME = 'records';
const DATABASE_VERSION = 2;
const BINARY_MANIFEST_SCHEMA = 'open-pencil-editor-binary-v2';
const BINARY_ASSET_SCHEMA = 'open-pencil-image-editor-asset-v2';

interface BinaryEditorAssetReference {
	readonly kind: 'image' | 'mask';
	readonly mediaType: string;
	readonly contentId: string;
}

interface BinaryEditorAssetRecord extends BinaryEditorAssetReference {
	readonly schema: typeof BINARY_ASSET_SCHEMA;
	readonly byteLength: number;
	readonly bytes: ArrayBuffer;
}

type BinaryEditorPersistenceRoot = PersistenceRoot<{
	readonly document: unknown;
	readonly assets: Readonly<Record<string, BinaryEditorAssetReference>>;
	readonly viewport: EditorViewport;
}>;

interface BinaryEditorPersistenceManifest {
	readonly schema: typeof BINARY_MANIFEST_SCHEMA;
	readonly roots: ReadonlyArray<BinaryEditorPersistenceRoot>;
}

export interface PreparedBinaryEditorPersistence {
	readonly manifest: BinaryEditorPersistenceManifest;
	readonly assets: ReadonlyMap<string, BinaryEditorAssetRecord>;
}

interface BinaryRecordStore {
	readonly get: (key: string) => Promise<unknown>;
	readonly put: (value: unknown, key: string) => void;
}

export class IndexedDatabasePersistenceStorage implements AsyncPersistenceStorage {
	constructor(
		private readonly documentId: string,
		private readonly factory: IDBFactory | undefined =
			typeof indexedDB === 'undefined' ? undefined : indexedDB
	) {}

	async read(): Promise<SerializedPersistenceRoots | null> {
		const database = await this.open();
		try {
			const manifest = await requestResult<BinaryEditorPersistenceManifest | undefined>(
				database.transaction(RECORD_STORE_NAME, 'readonly')
					.objectStore(RECORD_STORE_NAME)
					.get(manifestKey(this.documentId))
			);
			if (manifest) {
				return await restoreBinaryEditorPersistence(manifest, async contentId =>
					requestResult<BinaryEditorAssetRecord | undefined>(
						database.transaction(RECORD_STORE_NAME, 'readonly')
							.objectStore(RECORD_STORE_NAME)
							.get(assetKey(contentId))
					)
				);
			}
			return await requestResult<SerializedPersistenceRoots | undefined>(
				database.transaction(LEGACY_STORE_NAME, 'readonly')
					.objectStore(LEGACY_STORE_NAME)
					.get(this.documentId)
			) ?? null;
		} catch (error) {
			throw classifyPersistenceFailure(error);
		} finally {
			database.close();
		}
	}

	async write(serialized: SerializedPersistenceRoots): Promise<void> {
		const prepared = await prepareBinaryEditorPersistence(serialized);
		const database = await this.open();
		try {
			const transaction = database.transaction(
				[RECORD_STORE_NAME, LEGACY_STORE_NAME],
				'readwrite'
			);
			const objectStore = transaction.objectStore(RECORD_STORE_NAME);
			await writePreparedBinaryEditorPersistence({
				get: async key => requestResult(objectStore.get(key)),
				put: (value, key) => objectStore.put(value, key)
			}, this.documentId, prepared);
			if (prepared.manifest.roots.every(root => root.commitState !== 'staged')) {
				transaction.objectStore(LEGACY_STORE_NAME).delete(this.documentId);
			}
			await waitForIndexedDatabaseTransaction(transaction);
		} catch (error) {
			throw classifyPersistenceFailure(error);
		} finally {
			database.close();
		}
	}

	private async open(): Promise<IDBDatabase> {
		if (!this.factory) {
			throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'IndexedDB is unavailable');
		}
		const request = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
		request.addEventListener('upgradeneeded', () => {
			if (!request.result.objectStoreNames.contains(LEGACY_STORE_NAME)) {
				request.result.createObjectStore(LEGACY_STORE_NAME);
			}
			if (!request.result.objectStoreNames.contains(RECORD_STORE_NAME)) {
				request.result.createObjectStore(RECORD_STORE_NAME);
			}
		});
		try {
			return await requestResult(request);
		} catch (error) {
			throw classifyPersistenceFailure(error);
		}
	}
}

export async function prepareBinaryEditorPersistence(
	serialized: SerializedPersistenceRoots
): Promise<PreparedBinaryEditorPersistence> {
	try {
		const roots = deserializePersistenceRoots<EditorPersistencePayload<unknown>>(serialized);
		const assets = new Map<string, BinaryEditorAssetRecord>();
		const binaryRoots: Array<BinaryEditorPersistenceRoot> = [];
		for (const root of roots) {
			validatePersistedEditorAssets(root.payload.assets);
			validateEditorViewport(root.payload.viewport);
			const references: Record<string, BinaryEditorAssetReference> = {};
			for (const [assetId, asset] of Object.entries(root.payload.assets)) {
				const decoded = decodeImageDataUrl(asset.dataUrl);
				const contentId = await contentIdentity(asset.kind, decoded.mediaType, decoded.bytes);
				references[assetId] = { kind: asset.kind, mediaType: decoded.mediaType, contentId };
				if (!assets.has(contentId)) {
					assets.set(contentId, {
						schema: BINARY_ASSET_SCHEMA,
						kind: asset.kind,
						mediaType: decoded.mediaType,
						contentId,
						byteLength: decoded.bytes.byteLength,
						bytes: decoded.bytes.buffer
					});
				}
			}
			binaryRoots.push({
				...root,
				payload: {
					document: root.payload.document,
					assets: references,
					viewport: root.payload.viewport
				}
			});
		}
		return {
			manifest: { schema: BINARY_MANIFEST_SCHEMA, roots: binaryRoots },
			assets
		};
	} catch (error) {
		throw classifyPersistenceFailure(error);
	}
}

export async function writePreparedBinaryEditorPersistence(
	store: BinaryRecordStore,
	documentId: string,
	prepared: PreparedBinaryEditorPersistence
): Promise<number> {
	const reads = Array.from(
		prepared.assets.keys(),
		async contentId => [contentId, await store.get(assetKey(contentId))] as const
	);
	const existing = new Map(await Promise.all(reads));
	let assetWrites = 0;
	for (const [contentId, asset] of prepared.assets) {
		if (await isReusableBinaryAssetRecord(existing.get(contentId), asset)) {
			continue;
		}
		store.put(asset, assetKey(contentId));
		assetWrites += 1;
	}
	store.put(prepared.manifest, manifestKey(documentId));
	return assetWrites;
}

async function isReusableBinaryAssetRecord(
	value: unknown,
	expected: BinaryEditorAssetRecord
): Promise<boolean> {
	try {
		validateBinaryAssetRecord(value, expected);
		return await contentIdentity(
			expected.kind,
			expected.mediaType,
			new Uint8Array(value.bytes)
		) === expected.contentId;
	} catch {
		return false;
	}
}

export async function restoreBinaryEditorPersistence(
	manifest: unknown,
	readAsset: (contentId: string) => Promise<unknown>
): Promise<SerializedPersistenceRoots> {
	try {
		validateBinaryManifest(manifest);
		const restoredRoots: Array<PersistenceRoot<EditorPersistencePayload<unknown>>> = [];
		for (const root of manifest.roots) {
			const assets: Record<string, { kind: 'image' | 'mask'; dataUrl: string }> = {};
			for (const [assetId, reference] of Object.entries(root.payload.assets)) {
				validateBinaryAssetReference(reference);
				const record = await readAsset(reference.contentId);
				validateBinaryAssetRecord(record, reference);
				const bytes = new Uint8Array(record.bytes);
				if (await contentIdentity(record.kind, record.mediaType, bytes) !== record.contentId) {
					throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'binary editor asset identity mismatch');
				}
				assets[assetId] = {
					kind: reference.kind,
					dataUrl: encodeImageDataUrl(reference.mediaType, bytes)
				};
			}
			restoredRoots.push({
				...root,
				payload: {
					document: root.payload.document,
					assets,
					viewport: root.payload.viewport
				}
			});
		}
		return serializePersistenceRoots(restoredRoots);
	} catch (error) {
		throw classifyPersistenceFailure(error);
	}
}

function manifestKey(documentId: string): string {
	return `doc/${documentId}/manifest`;
}

function assetKey(contentId: string): string {
	return `blob/${contentId}`;
}

function validateBinaryManifest(value: unknown): asserts value is BinaryEditorPersistenceManifest {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('schema' in value) ||
		value.schema !== BINARY_MANIFEST_SCHEMA ||
		!('roots' in value) ||
		!Array.isArray(value.roots)
	) {
		throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid binary editor manifest');
	}
	for (const root of value.roots) {
		if (
			typeof root !== 'object' ||
			root === null ||
			!('payload' in root) ||
			typeof root.payload !== 'object' ||
			root.payload === null ||
			!('assets' in root.payload) ||
			typeof root.payload.assets !== 'object' ||
			root.payload.assets === null ||
			Array.isArray(root.payload.assets) ||
			!('viewport' in root.payload)
		) {
			throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid binary editor manifest');
		}
		validateEditorViewport(root.payload.viewport as EditorViewport);
	}
}

function validateBinaryAssetReference(value: unknown): asserts value is BinaryEditorAssetReference {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('kind' in value) ||
		(value.kind !== 'image' && value.kind !== 'mask') ||
		!('mediaType' in value) ||
		typeof value.mediaType !== 'string' ||
		!value.mediaType.startsWith('image/') ||
		!('contentId' in value) ||
		typeof value.contentId !== 'string' ||
		!/^[0-9a-f]{64}$/u.test(value.contentId)
	) {
		throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid binary editor asset reference');
	}
}

function validateBinaryAssetRecord(
	value: unknown,
	reference: BinaryEditorAssetReference
): asserts value is BinaryEditorAssetRecord {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('schema' in value) ||
		value.schema !== BINARY_ASSET_SCHEMA ||
		!('kind' in value) ||
		value.kind !== reference.kind ||
		!('mediaType' in value) ||
		value.mediaType !== reference.mediaType ||
		!('contentId' in value) ||
		value.contentId !== reference.contentId ||
		!('byteLength' in value) ||
		!Number.isSafeInteger(value.byteLength) ||
		!('bytes' in value) ||
		!(value.bytes instanceof ArrayBuffer) ||
		value.bytes.byteLength !== value.byteLength
	) {
		throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid binary editor asset record');
	}
}

function decodeImageDataUrl(dataUrl: string): { readonly mediaType: string; readonly bytes: Uint8Array<ArrayBuffer> } {
	const separator = dataUrl.indexOf(',');
	if (separator === -1 || !dataUrl.startsWith('data:image/')) {
		throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid binary editor asset data URL');
	}
	const descriptor = dataUrl.slice('data:'.length, separator);
	const parts = descriptor.split(';');
	const mediaType = parts.shift()?.toLowerCase();
	if (!mediaType?.startsWith('image/')) {
		throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid binary editor asset data URL');
	}
	const base64Index = parts.findIndex(part => part.toLowerCase() === 'base64');
	const normalizedDescriptor = [mediaType, ...parts.filter((_, index) => index !== base64Index)]
		.join(';');
	const payload = dataUrl.slice(separator + 1);
	try {
		if (base64Index !== -1) {
			const binary = atob(payload);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index++) {
				bytes[index] = binary.codePointAt(index) ?? 0;
			}
			return { mediaType: normalizedDescriptor, bytes };
		}
		return {
			mediaType: normalizedDescriptor,
			bytes: decodePercentEncodedBytes(payload)
		};
	} catch {
		throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid binary editor asset data URL');
	}
}

function decodePercentEncodedBytes(payload: string): Uint8Array<ArrayBuffer> {
	const bytes: Array<number> = [];
	const encoder = new TextEncoder();
	for (let index = 0; index < payload.length;) {
		if (payload[index] === '%') {
			const encoded = payload.slice(index + 1, index + 3);
			if (!/^[0-9a-f]{2}$/iu.test(encoded)) {
				throw new TypeError('invalid percent-encoded byte');
			}
			bytes.push(Number.parseInt(encoded, 16));
			index += 3;
			continue;
		}
		const codePoint = payload.codePointAt(index);
		if (codePoint === undefined) {
			break;
		}
		const character = String.fromCodePoint(codePoint);
		bytes.push(...encoder.encode(character));
		index += character.length;
	}
	return Uint8Array.from(bytes);
}

function encodeImageDataUrl(mediaType: string, bytes: Uint8Array): string {
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 0x80_00) {
		binary += String.fromCodePoint(...bytes.subarray(offset, offset + 0x80_00));
	}
	return `data:${mediaType};base64,${btoa(binary)}`;
}

async function contentIdentity(
	kind: 'image' | 'mask',
	mediaType: string,
	bytes: Uint8Array
): Promise<string> {
	if (!crypto?.subtle) {
		throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'SHA-256 is unavailable');
	}
	const metadata = new TextEncoder().encode(`${kind}\0${mediaType}\0`);
	const input = new Uint8Array(metadata.byteLength + bytes.byteLength);
	input.set(metadata);
	input.set(bytes, metadata.byteLength);
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
	return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export class EditorWorkingDocument {
	private queue = Promise.resolve();

	constructor(
		private readonly storage: AsyncPersistenceStorage =
			new IndexedDatabasePersistenceStorage(EDITOR_WORKING_DOCUMENT_ID)
	) {}

	async recover(): Promise<EditorPersistencePayload<EditorDocument> | undefined> {
		try {
			const serialized = await this.storage.read();
			if (!serialized) {
				return undefined;
			}
			const root = recoverPersistenceRoot<EditorPersistencePayload<unknown>>(
				deserializePersistenceRoots<EditorPersistencePayload<unknown>>(serialized),
				EDITOR_WORKING_DOCUMENT_ID
			);
			if (!root) {
				return undefined;
			}
			if (root.producerTipSetHash !== EDITOR_PRODUCER_TIP_SET_HASH) {
				throw new PersistenceError(
					'E_PERSISTENCE_MIGRATION',
					'working document producer tip set is incompatible'
				);
			}
			const payload = {
				document: parseEditorDocument(root.payload.document),
				assets: root.payload.assets,
				viewport: root.payload.viewport
			};
			validatePersistedEditorAssets(payload.assets);
			validateEditorViewport(payload.viewport);
			return payload;
		} catch (error) {
			throw error instanceof PersistenceError ?
				error :
				new PersistenceError('E_PERSISTENCE_MIGRATION', 'working document recovery failed');
		}
	}

	async save(input: EditorPersistenceInput<EditorDocument>): Promise<void> {
		const run = this.queue.then(async () => {
			await saveEditorPersistenceAsync(this.storage, {
				documentId: EDITOR_WORKING_DOCUMENT_ID,
				producerTipSetHash: EDITOR_PRODUCER_TIP_SET_HASH,
				rootId: createRootId(),
				updatedAt: Date.now(),
				input
			});
		});
		this.queue = run.catch(() => undefined);
		return run;
	}
}

function createRootId(): string {
	return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
}

async function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.addEventListener('success', () => resolve(request.result));
		request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')));
	});
}

export async function waitForIndexedDatabaseTransaction(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.addEventListener('complete', () => resolve());
		transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')));
		transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed')));
	});
}
