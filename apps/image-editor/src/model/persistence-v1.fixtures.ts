import type { PersistenceRoot } from './persistence-v1';

export interface PersistenceFixturePayload {
	layoutId: string;
	stoneCount: number;
	terminal: boolean;
}

export const persistenceFixtureRoots: ReadonlyArray<PersistenceRoot<PersistenceFixturePayload>> = [
	{
		schema: 'open-pencil-persistence-v1',
		producerTipSetHash: 'efbddd5628d343064e411a7dfb849af473e059b1abb89e45b9f22027e05d7d20',
		documentId: 'fixture-document',
		rootId: '1'.repeat(64),
		sequence: 7,
		payload: { layoutId: 'classic-144', stoneCount: 18, terminal: false },
		commitState: 'committed',
		updatedAt: 1_754_000_007_000
	},
	{
		schema: 'open-pencil-persistence-v1',
		producerTipSetHash: 'efbddd5628d343064e411a7dfb849af473e059b1abb89e45b9f22027e05d7d20',
		documentId: 'fixture-document',
		rootId: '2'.repeat(64),
		sequence: 8,
		payload: { layoutId: 'classic-144', stoneCount: 0, terminal: true },
		commitState: 'staged',
		updatedAt: 1_754_000_008_000
	},
	{
		schema: 'open-pencil-persistence-v1',
		producerTipSetHash: 'efbddd5628d343064e411a7dfb849af473e059b1abb89e45b9f22027e05d7d20',
		documentId: 'fixture-document',
		rootId: '1'.repeat(64),
		sequence: 8,
		payload: { layoutId: 'classic-144', stoneCount: 0, terminal: true },
		commitState: 'acknowledged',
		updatedAt: 1_754_000_008_001
	}
];
