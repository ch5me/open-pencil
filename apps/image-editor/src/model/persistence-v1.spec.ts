import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from './base64';
import {
	assertSingleRoot,
	classifyPersistenceFailure,
	deserializePersistenceRoots,
	PersistenceError,
	migratePersistenceRoot,
	migratePersistenceRootAsync,
	recoverPersistenceRoot,
	serializePersistenceRoots,
	validatePersistenceRoot,
	type PersistenceRoot
} from './persistence-v1';
import { persistenceFixtureRoots } from './persistence-v1.fixtures';

const root = (overrides: Partial<PersistenceRoot<{ value: string }>> = {}): PersistenceRoot<{ value: string }> => ({
	schema: 'open-pencil-persistence-v1',
	producerTipSetHash: 'efbddd5628d343064e411a7dfb849af473e059b1abb89e45b9f22027e05d7d20',
	documentId: 'document',
	rootId: 'a'.repeat(64),
	sequence: 1,
	payload: { value: 'old' },
	commitState: 'committed',
	updatedAt: 1,
	...overrides
});

describe('persistence-v1', () => {
	it('recovers the newest acknowledged or committed root, never staged data', () => {
		const recovered = recoverPersistenceRoot([
			root({ sequence: 4, rootId: 'd'.repeat(64), payload: { value: 'staged' }, commitState: 'staged' }),
			root({ sequence: 2, payload: { value: 'committed' } }),
			root({ sequence: 3, rootId: 'c'.repeat(64), payload: { value: 'ack' }, commitState: 'acknowledged' })
		], 'document');

		expect(recovered?.payload).toEqual({ value: 'ack' });
		expect(recoverPersistenceRoot([root()], 'other')).toBeUndefined();
	});

	it('recovers all 100 deterministic termination seeds as ACK or full new root', () => {
		for (let seed = 0; seed < 100; seed++) {
			const oldRoot = root({ sequence: seed, updatedAt: seed });
			const nextRoot = root({
				rootId: `${seed.toString(16).padStart(2, '0')}${'b'.repeat(62)}`,
				sequence: seed + 1,
				commitState: seed % 2 === 0 ? 'acknowledged' : 'committed',
				payload: { value: `seed-${seed}` },
				updatedAt: seed + 1
			});
			expect(recoverPersistenceRoot([
				oldRoot,
				{ ...nextRoot, commitState: 'staged' },
				nextRoot
			], 'document')?.payload.value).toBe(`seed-${seed}`);
		}
	});

	it('round-trips a real persistence fixture within Base64 storage overhead', () => {
		const serialized = JSON.stringify(persistenceFixtureRoots);
		const encoded = toBase64(serialized);
		const decoded = JSON.parse(fromBase64(encoded)) as typeof persistenceFixtureRoots;

		expect(decoded).toEqual(persistenceFixtureRoots);
		expect(encoded).toHaveLength(Math.ceil(serialized.length / 3) * 4);
		expect(encoded.length).toBeLessThanOrEqual(Math.ceil(serialized.length * 4 / 3) + 3);
	});

	it('round-trips the durable envelope without mutating source roots', () => {
		const source = persistenceFixtureRoots.map(root => ({ ...root, payload: { ...root.payload } }));
		const serialized = serializePersistenceRoots(source);

		expect(deserializePersistenceRoots(serialized)).toEqual(source);
		expect(source).toEqual(persistenceFixtureRoots);
	});

	it('keeps the prior acknowledged root when termination hits every durable boundary', () => {
		for (let seed = 0; seed < 100; seed++) {
			const oldRoot = root({ sequence: seed, updatedAt: seed });
			const nextRoot = root({
				rootId: `${seed.toString(16).padStart(2, '0')}${'b'.repeat(62)}`,
				sequence: seed + 1,
				commitState: 'acknowledged',
				payload: { value: `seed-${seed}` },
				updatedAt: seed + 1
			});
			const staged = [oldRoot, { ...nextRoot, commitState: 'staged' as const }];
			const boundaries = [
				staged,
				[nextRoot]
			];

			for (const [index, roots] of boundaries.entries()) {
				const recovered = recoverPersistenceRoot(
					deserializePersistenceRoots(serializePersistenceRoots(roots)),
					'document'
				);
				expect(recovered?.rootId).toBe(index === 0 ? oldRoot.rootId : nextRoot.rootId);
				expect(() => assertSingleRoot(roots)).not.toThrow();
			}
		}
	});

	it('recovers the acknowledged fixture root without exposing staged mixed-root data', () => {
		const recovered = recoverPersistenceRoot(persistenceFixtureRoots, 'fixture-document');

		expect(recovered?.commitState).toBe('acknowledged');
		expect(recovered?.rootId).toBe('1'.repeat(64));
		expect(recovered?.payload.terminal).toBe(true);
		expect(() => assertSingleRoot(persistenceFixtureRoots)).not.toThrow();
		expect(recoverPersistenceRoot(persistenceFixtureRoots, 'missing-document')).toBeUndefined();
	});

	it('validates identity and rejects mixed committed roots', () => {
		expect(() => validatePersistenceRoot(root({ rootId: 'bad' }))).toThrow(PersistenceError);
		expect(() => validatePersistenceRoot(root({ producerTipSetHash: 'bad' }))).toThrow(PersistenceError);
		expect(() => assertSingleRoot([
			root(),
			root({ rootId: 'b'.repeat(64), sequence: 2 })
		])).toThrow('E_PERSISTENCE_MIXED_ROOTS');
		expect(() => assertSingleRoot([
			root({ commitState: 'staged' }),
			root({ rootId: 'b'.repeat(64), commitState: 'staged' })
		])).not.toThrow();
		expect(() => assertSingleRoot([
			root(),
			root({ rootId: 'b'.repeat(64), commitState: 'acknowledged' })
		])).toThrow('E_PERSISTENCE_MIXED_ROOTS');
		expect(() => assertSingleRoot([
			root(),
			root({ documentId: 'other-document' })
		])).toThrow('E_PERSISTENCE_MIXED_ROOTS');
	});

	it('rejects non-string runtime identities with typed errors', () => {
		for (const invalid of [1, {}, Symbol('identity')]) {
			expect(() => validatePersistenceRoot({
				...root(),
				documentId: invalid
			})).toThrow('E_PERSISTENCE_INVALID_ROOT');
			expect(() => validatePersistenceRoot({
				...root(),
				rootId: invalid
			})).toThrow('E_PERSISTENCE_INVALID_ROOT');
			expect(() => validatePersistenceRoot({
				...root(),
				producerTipSetHash: invalid
			})).toThrow('E_PERSISTENCE_INVALID_ROOT');
		}
	});

	it('classifies quota and migration failures without destructive fallback', () => {
		const quotaSource = new Error('full');
		Object.defineProperty(quotaSource, 'name', { value: 'QuotaExceededError' });
		const quota = classifyPersistenceFailure(quotaSource);
		expect(quota.code).toBe('E_PERSISTENCE_QUOTA');
		expect(classifyPersistenceFailure(new Error('bad schema')).code).toBe('E_PERSISTENCE_MIGRATION');
		expect(classifyPersistenceFailure(new PersistenceError('E_PERSISTENCE_QUOTA', 'full')).code).toBe(quota.code);
	});

	it('rejects malformed or mixed durable envelopes with typed errors', () => {
		expect(() => deserializePersistenceRoots('not-base64')).toThrow('E_PERSISTENCE_MIGRATION');
		expect(() => serializePersistenceRoots([
			root(),
			root({ rootId: 'b'.repeat(64), sequence: 2 })
		])).toThrow('E_PERSISTENCE_MIXED_ROOTS');
	});

	it('runs 100 migrations through durable boundaries without mixed committed roots', () => {
		for (let seed = 0; seed < 100; seed++) {
			let serialized: string | null = null;
			const storage = {
				read: () => serialized,
				write: (next: string) => {
					serialized = next;
				}
			};
			const migrated = migratePersistenceRoot(storage, {
				documentId: 'document',
				producerTipSetHash: root().producerTipSetHash,
				rootId: `${seed.toString(16).padStart(2, '0')}${'c'.repeat(62)}`,
				payload: { value: `migrated-${seed}` },
				updatedAt: seed + 10
			});
			expect(migrated.commitState).toBe('acknowledged');
			expect(deserializePersistenceRoots<{ value: string }>(serialized ?? '')).toEqual([migrated]);
			expect(() => assertSingleRoot(deserializePersistenceRoots(serialized ?? ''))).not.toThrow();
		}
	});

	it('keeps the last recoverable root when a durable boundary fails', () => {
		for (let seed = 0; seed < 100; seed++) {
			const oldRoot = root({ sequence: seed, updatedAt: seed, commitState: 'acknowledged' });
			for (const failedBoundary of [1, 2, 3]) {
				let serialized = serializePersistenceRoots([oldRoot]);
				let writes = 0;
				const storage = {
					read: () => serialized,
					write: (next: string) => {
						writes++;
						if (writes === failedBoundary) {
							const error = new Error('full');
							Object.defineProperty(error, 'name', { value: 'QuotaExceededError' });
							throw error;
						}
						serialized = next;
					}
				};

				expect(() => migratePersistenceRoot(storage, {
					documentId: 'document',
					producerTipSetHash: oldRoot.producerTipSetHash,
					rootId: `${seed.toString(16).padStart(2, '0')}${'d'.repeat(62)}`,
					payload: { value: `new-${seed}` },
					updatedAt: seed + 1
				})).toThrow('E_PERSISTENCE_QUOTA');

				const durableRoots = deserializePersistenceRoots<{ value: string }>(serialized);
				const recovered = recoverPersistenceRoot(durableRoots, 'document');
				expect(recovered?.payload.value).toBe(failedBoundary === 3 ? `new-${seed}` : `old`);
				expect(() => assertSingleRoot(durableRoots)).not.toThrow();
				expect(new Set(durableRoots
					.filter(root => root.commitState !== 'staged')
					.map(root => root.rootId)).size).toBeLessThanOrEqual(1);
			}
		}
	});

	it('keeps an ACK or full new root across async durable boundaries for 100 seeds', async () => {
		for (let seed = 0; seed < 100; seed++) {
			const oldRoot = root({ sequence: seed, updatedAt: seed, commitState: 'acknowledged' });
			for (const failedBoundary of [0, 1, 2, 3]) {
				let serialized = serializePersistenceRoots([oldRoot]);
				let writes = 0;
				const storage = {
					read: async () => serialized,
					write: async (next: string) => {
						writes += 1;
						if (writes === failedBoundary) {
							await Promise.resolve();
							const error = new Error('terminated');
							Object.defineProperty(error, 'name', { value: 'QuotaExceededError' });
							throw error;
						}
						serialized = next;
					}
				};
				const migration = migratePersistenceRootAsync(storage, {
					documentId: 'document',
					producerTipSetHash: oldRoot.producerTipSetHash,
					rootId: `${seed.toString(16).padStart(2, '0')}${'e'.repeat(62)}`,
					payload: { value: `new-${seed}` },
					updatedAt: seed + 1
				});

				const error = await migration.then(() => undefined).catch((error_: unknown) => error_);
				expect(error instanceof Error ? error.message : undefined).toBe(
					failedBoundary === 0 ? undefined : 'E_PERSISTENCE_QUOTA: storage quota exceeded'
				);
				const roots = deserializePersistenceRoots<{ value: string }>(serialized);
				const recovered = recoverPersistenceRoot(roots, 'document');
				expect(recovered?.payload.value).toBe(
					failedBoundary === 1 || failedBoundary === 2 ? 'old' : `new-${seed}`
				);
				expect(new Set(roots
					.filter(candidate => candidate.commitState !== 'staged')
					.map(candidate => candidate.rootId)).size).toBeLessThanOrEqual(1);
			}
		}
	});
});
