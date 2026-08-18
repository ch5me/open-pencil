import { fromBase64, toBase64 } from './base64';

export type PersistenceCommitState = 'staged' | 'committed' | 'acknowledged';

export type PersistenceFailureCode =
  'E_PERSISTENCE_INVALID_ROOT' |
  'E_PERSISTENCE_MIXED_ROOTS' |
  'E_PERSISTENCE_QUOTA' |
  'E_PERSISTENCE_MIGRATION';

export interface PersistenceRoot<T> {
	readonly schema: 'open-pencil-persistence-v1';
	readonly producerTipSetHash: string;
	readonly documentId: string;
	readonly rootId: string;
	readonly sequence: number;
	readonly payload: T;
	readonly commitState: PersistenceCommitState;
	readonly updatedAt: number;
}

export interface PersistenceStorage {
	readonly read: () => SerializedPersistenceRoots | null;
	readonly write: (serialized: SerializedPersistenceRoots) => void;
}

export interface AsyncPersistenceStorage {
	readonly read: () => Promise<SerializedPersistenceRoots | null>;
	readonly write: (serialized: SerializedPersistenceRoots) => Promise<void>;
}

export interface PersistenceMigration<T> {
	readonly documentId: string;
	readonly producerTipSetHash: string;
	readonly rootId: string;
	readonly payload: T;
	readonly updatedAt: number;
}

export type SerializedPersistenceRoots = string;

export class PersistenceError extends Error {
	constructor(
		readonly code: PersistenceFailureCode,
		message: string
	) {
		super(`${code}: ${message}`);
		this.name = 'PersistenceError';
	}
}

function isRootId(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isProducerTipSetHash(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

export function validatePersistenceRoot<T>(root: PersistenceRoot<T> | unknown): asserts root is PersistenceRoot<T> {
	const candidate = root as Partial<PersistenceRoot<T>> | null;
	if (
		typeof root !== 'object' ||
		root === null ||
		candidate?.schema !== 'open-pencil-persistence-v1' ||
		!isProducerTipSetHash(candidate.producerTipSetHash) ||
		typeof candidate.documentId !== 'string' ||
		candidate.documentId.length === 0 ||
		!isRootId(candidate.rootId) ||
		!Number.isSafeInteger(candidate.sequence) ||
		(candidate.sequence ?? -1) < 0 ||
		(candidate.commitState !== 'staged' && candidate.commitState !== 'committed' && candidate.commitState !== 'acknowledged') ||
		candidate.payload === undefined ||
		!Number.isFinite(candidate.updatedAt)
	) {
		throw new PersistenceError('E_PERSISTENCE_INVALID_ROOT', 'invalid persistence root');
	}
}

/**
 * Recover only a durable acknowledgement or complete replacement root.
 * Staged roots are never visible, and a failed write cannot erase the prior root.
 */
export function recoverPersistenceRoot<T>(
	roots: ReadonlyArray<PersistenceRoot<T>>,
	documentId: string
): PersistenceRoot<T> | undefined {
	const candidates = roots.filter(root => root.documentId === documentId);
	for (const candidate of candidates) {
		validatePersistenceRoot(candidate);
	}
	const committed = candidates.filter(root =>
		root.commitState === 'committed' || root.commitState === 'acknowledged'
	);
	if (committed.length === 0) {
		return undefined;
	}
	return committed
		.slice()
		.sort((left, right) => right.sequence - left.sequence || right.updatedAt - left.updatedAt)[0];
}

export function assertSingleRoot<T>(roots: ReadonlyArray<PersistenceRoot<T>>): void {
	const committedRoots = roots.filter(root =>
		root.commitState === 'committed' || root.commitState === 'acknowledged'
	);
	const documentIds = new Set(committedRoots.map(root => root.documentId));
	const rootIds = new Set(committedRoots.map(root => root.rootId));
	const producerTipSetHashes = new Set(committedRoots.map(root => root.producerTipSetHash));
	if (documentIds.size > 1 || rootIds.size > 1 || producerTipSetHashes.size > 1) {
		throw new PersistenceError('E_PERSISTENCE_MIXED_ROOTS', 'committed roots are mixed');
	}
}

/**
 * Write one replacement through staged, committed, and acknowledged boundaries.
 * A failed boundary leaves the previous serialized value or a recoverable root.
 */
export function migratePersistenceRoot<T>(
	storage: PersistenceStorage,
	migration: PersistenceMigration<T>
): PersistenceRoot<T> {
	validatePersistenceMigration(migration);
	let roots: ReadonlyArray<PersistenceRoot<T>>;
	try {
		const serialized = storage.read();
		roots = serialized ? deserializePersistenceRoots<T>(serialized) : [];
	} catch (error) {
		throw classifyPersistenceFailure(error);
	}

	const previous = recoverPersistenceRoot(roots, migration.documentId);
	const staged: PersistenceRoot<T> = {
		schema: 'open-pencil-persistence-v1',
		producerTipSetHash: migration.producerTipSetHash,
		documentId: migration.documentId,
		rootId: migration.rootId,
		sequence: (previous?.sequence ?? -1) + 1,
		payload: migration.payload,
		commitState: 'staged',
		updatedAt: migration.updatedAt
	};

	try {
		storage.write(serializePersistenceRoots(previous ? [previous, staged] : [staged]));
	} catch (error) {
		throw classifyPersistenceFailure(error);
	}

	const committed: PersistenceRoot<T> = { ...staged, commitState: 'committed' };
	try {
		storage.write(serializePersistenceRoots([committed]));
	} catch (error) {
		throw classifyPersistenceFailure(error);
	}

	const acknowledged: PersistenceRoot<T> = { ...committed, commitState: 'acknowledged' };
	try {
		storage.write(serializePersistenceRoots([acknowledged]));
	} catch (error) {
		throw classifyPersistenceFailure(error);
	}
	return acknowledged;
}

export async function migratePersistenceRootAsync<T>(
	storage: AsyncPersistenceStorage,
	migration: PersistenceMigration<T>
): Promise<PersistenceRoot<T>> {
	validatePersistenceMigration(migration);
	let roots: ReadonlyArray<PersistenceRoot<T>>;
	try {
		const serialized = await storage.read();
		roots = serialized ? deserializePersistenceRoots<T>(serialized) : [];
	} catch (error) {
		throw classifyPersistenceFailure(error);
	}

	const previous = recoverPersistenceRoot(roots, migration.documentId);
	const staged: PersistenceRoot<T> = {
		schema: 'open-pencil-persistence-v1',
		producerTipSetHash: migration.producerTipSetHash,
		documentId: migration.documentId,
		rootId: migration.rootId,
		sequence: (previous?.sequence ?? -1) + 1,
		payload: migration.payload,
		commitState: 'staged',
		updatedAt: migration.updatedAt
	};

	await writePersistenceBoundary(storage, previous ? [previous, staged] : [staged]);
	const committed: PersistenceRoot<T> = { ...staged, commitState: 'committed' };
	await writePersistenceBoundary(storage, [committed]);
	const acknowledged: PersistenceRoot<T> = { ...committed, commitState: 'acknowledged' };
	await writePersistenceBoundary(storage, [acknowledged]);
	return acknowledged;
}

/**
 * Encode a validated root set for a single durable storage record.
 * Validation happens before encoding so malformed or mixed data cannot replace
 * the last acknowledged root.
 */
export function serializePersistenceRoots<T>(
	roots: ReadonlyArray<PersistenceRoot<T>>
): SerializedPersistenceRoots {
	for (const root of roots) {
		validatePersistenceRoot(root);
	}
	assertSingleRoot(roots);
	try {
		return toBase64(JSON.stringify(roots));
	} catch (error) {
		throw classifyPersistenceFailure(error);
	}
}

export function deserializePersistenceRoots<T>(
	serialized: SerializedPersistenceRoots
): ReadonlyArray<PersistenceRoot<T>> {
	try {
		const parsed: unknown = JSON.parse(fromBase64(serialized));
		if (!Array.isArray(parsed)) {
			throw new TypeError('persistence root set must be an array');
		}
		const roots = parsed as Array<PersistenceRoot<T>>;
		for (const root of roots) {
			validatePersistenceRoot(root);
		}
		assertSingleRoot(roots);
		return roots;
	} catch (error) {
		throw classifyPersistenceFailure(error);
	}
}

export function classifyPersistenceFailure(error: unknown): PersistenceError {
	if (error instanceof PersistenceError) {
		return error;
	}
	if (error instanceof Error && (
		error.name === 'QuotaExceededError' ||
		error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
	)) {
		return new PersistenceError('E_PERSISTENCE_QUOTA', 'storage quota exceeded');
	}
	return new PersistenceError('E_PERSISTENCE_MIGRATION', 'persistence migration failed');
}

function validatePersistenceMigration<T>(migration: PersistenceMigration<T>): void {
	if (
		typeof migration.documentId !== 'string' ||
		migration.documentId.length === 0 ||
		!isProducerTipSetHash(migration.producerTipSetHash) ||
		!isRootId(migration.rootId) ||
		migration.payload === undefined ||
		!Number.isFinite(migration.updatedAt)
	) {
		throw new PersistenceError('E_PERSISTENCE_MIGRATION', 'invalid persistence migration');
	}
}

async function writePersistenceBoundary<T>(
	storage: AsyncPersistenceStorage,
	roots: ReadonlyArray<PersistenceRoot<T>>
): Promise<void> {
	try {
		await storage.write(serializePersistenceRoots(roots));
	} catch (error) {
		throw classifyPersistenceFailure(error);
	}
}
