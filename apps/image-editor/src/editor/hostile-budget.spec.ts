import { describe, expect, it } from 'vitest';
import { importPsd, PsdImportError } from '../adapters/editor-psd';
import {
	EditorArchiveBudgetError,
	EditorAssetRegistry,
	type SerializedEditorAssets
} from '../rendering/editor-asset-registry';

type BudgetCheck = () => Promise<void>;

async function hostileBudgetEvidence(checks: ReadonlyArray<BudgetCheck>) {
	let failureCount = 0;
	for (const check of checks) {
		try {
			await check();
			failureCount += 1;
		} catch (error) {
			if (
				!(error instanceof EditorArchiveBudgetError) &&
				!(error instanceof PsdImportError && error.code === 'E_PSD_IMPORT_BUDGET')
			) {
				failureCount += 1;
			}
		}
	}
	return {
		status: failureCount === 0 ? 'PASS' : 'FAIL',
		scenarioCount: checks.length,
		outputCount: checks.length,
		failureCount
	};
}

function hostileArchive(): SerializedEditorAssets {
	return Object.fromEntries(
		Array.from({ length: 513 }, (_, index) => [
			`asset-${index}`,
			{ kind: 'image', dataUrl: 'data:image/png;base64,asset' }
		])
	);
}

function hostilePsd(): ArrayBuffer {
	const buffer = new ArrayBuffer(26);
	const bytes = new Uint8Array(buffer);
	const view = new DataView(buffer);
	bytes.set([0x38, 0x42, 0x50, 0x53]);
	view.setUint16(4, 1, false);
	view.setUint16(12, 4, false);
	view.setUint32(14, 4096, false);
	view.setUint32(18, 8193, false);
	view.setUint16(22, 8, false);
	view.setUint16(24, 3, false);
	return buffer;
}

describe('hostile editor input budgets', () => {
	it('rejects hostile archive and PSD inputs with typed budget failures', async () => {
		const registry = new EditorAssetRegistry();

		expect(await hostileBudgetEvidence([
			async () => registry.restore(hostileArchive()),
			async () => importPsd(hostilePsd(), registry).then(() => undefined)
		])).toEqual({
			status: 'PASS',
			scenarioCount: 2,
			outputCount: 2,
			failureCount: 0
		});
	});

	it('detects the exact seeded defect when both budget guards are omitted', async () => {
		expect(await hostileBudgetEvidence([
			async () => Promise.resolve(),
			async () => Promise.resolve()
		])).toEqual({
			status: 'FAIL',
			scenarioCount: 2,
			outputCount: 2,
			failureCount: 2
		});
	});
});
