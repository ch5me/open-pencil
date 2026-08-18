import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readPsd, writePsd } from 'ag-psd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPsd, importPsd, type PsdWarning } from '../adapters/editor-psd';
import type { EditorDocument } from '../model/editor-document';
import type { EditorAssetRegistry } from '../rendering/editor-asset-registry';

vi.mock('ag-psd', () => ({
	readPsd: vi.fn(),
	writePsd: vi.fn(() => new ArrayBuffer(16))
}));

const CORPUS_HASH = '147f36bff4acb8a27f9f3bd3500241c85a58971fe54f0be7bfba003f49e37b3a';

interface WarningScenario {
	readonly id: string;
	readonly expectedWarningCodes: ReadonlyArray<string>;
}

interface WarningCorpus {
	readonly scenarios: ReadonlyArray<WarningScenario>;
	readonly externalCorpus: {
		readonly status: string;
		readonly files: ReadonlyArray<unknown>;
	};
}

function canvas(width = 32, height = 32): HTMLCanvasElement {
	return {
		width,
		height,
		getContext: () => ({
			drawImage: vi.fn(),
			rotate: vi.fn(),
			translate: vi.fn(),
			globalCompositeOperation: 'source-over'
		})
	} as unknown as HTMLCanvasElement;
}

function warningEvidence(
	warnings: ReadonlyArray<PsdWarning>,
	expectedCodes: ReadonlyArray<string>,
	scenarioCount: number
) {
	const actualCodes = warnings.map(warning => warning.code).sort((left, right) => left.localeCompare(right));
	const expected = [...expectedCodes].sort((left, right) => left.localeCompare(right));
	return {
		status: actualCodes.length > 0 && actualCodes.join('\n') === expected.join('\n') ? 'PASS' : 'FAIL',
		scenarioCount,
		outputCount: warnings.length,
		actualCodes,
		expectedCodes: expected
	};
}

function exportDocument(): EditorDocument {
	const common = {
		visible: true,
		locked: false,
		opacity: 1,
		blendMode: 'normal' as const,
		parentId: null,
		maskEnabled: false,
		maskAssetId: null,
		clipped: false,
		adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 }
	};
	return {
		version: 1,
		width: 64,
		height: 64,
		selectedLayerId: 'text',
		layers: [
			{
				...common,
				id: 'text',
				name: 'Text',
				kind: 'text',
				bounds: { x: 0, y: 0, width: 16, height: 16 },
				rotation: 0,
				content: 'Text',
				fontFamily: 'sans-serif',
				color: '#ffffff',
				fontSize: 12,
				fontWeight: 400,
				alignment: 'left',
				letterSpacing: 0,
				lineHeight: 1,
				wrapping: 'word'
			},
			{
				...common,
				id: 'shape',
				name: 'Shape',
				kind: 'shape',
				bounds: { x: 16, y: 0, width: 16, height: 16 },
				rotation: 0,
				form: 'rectangle',
				fill: '#ffffff',
				stroke: '#000000',
				cornerRadius: 0,
				path: []
			},
			{
				...common,
				id: 'adjustment',
				name: 'Adjustment',
				kind: 'adjustment',
				adjustments: { brightness: 0, contrast: 0, saturation: 0.5, blur: 2 }
			},
			{
				...common,
				id: 'rotated-mask',
				name: 'Rotated mask',
				kind: 'image',
				bounds: { x: 0, y: 16, width: 16, height: 16 },
				rotation: 15,
				seed: 'warning-corpus',
				assetId: 'image',
				sourceWidth: 16,
				sourceHeight: 16,
				sourceResolution: 72,
				crop: null,
				maskEnabled: true,
				maskAssetId: 'mask'
			}
		]
	};
}

async function runScenario(id: string): Promise<{ warnings: ReadonlyArray<PsdWarning>; outputBytes: number }> {
	vi.stubGlobal('document', { createElement: () => canvas() });
	const registry = {
		registerCanvas: vi.fn(),
		removeAsset: vi.fn(),
		sourceFor: vi.fn(() => canvas()),
		maskFor: vi.fn(layer => layer.id === 'rotated-mask' ? canvas() : undefined)
	} as unknown as EditorAssetRegistry;

	switch (id) {
		case 'synthetic-import-corrupt-layer': {
			vi.mocked(readPsd).mockReturnValue({
				width: 32,
				height: 32,
				children: [
					{ name: 'Corrupt layer', text: { style: {} } },
					{ name: 'Unsupported blend', blendMode: 'overlay' },
					{
						name: 'Hue adjustment',
						adjustment: { type: 'hue/saturation', master: { saturation: 50 } }
					},
					{
						name: 'Skipped adjustment',
						adjustment: { type: 'levels', rgb: { shadowInput: 0, highlightInput: 255, shadowOutput: 0, highlightOutput: 255, midtoneInput: 1 } }
					}
				]
			} as unknown as ReturnType<typeof readPsd>);
			const imported = await importPsd(new ArrayBuffer(0), registry);
			return { warnings: imported.warnings, outputBytes: 0 };
		}
		case 'synthetic-export-lossy-features': {
			const exported = await exportPsd(exportDocument(), registry, canvas(64, 64));
			return { warnings: exported.warnings, outputBytes: exported.buffer.byteLength };
		}
		default: {
			throw new Error(`Unknown PSD warning scenario: ${id}`);
		}
	}
}

async function readCorpus(): Promise<{ raw: Buffer; corpus: WarningCorpus }> {
	const raw = await readFile(new URL('./fixtures/psd-warning-corpus-v1.json', import.meta.url));
	return { raw, corpus: JSON.parse(raw.toString()) as WarningCorpus };
}

async function runCorpus(corpus: WarningCorpus, omittedCode?: string) {
	const warnings: Array<PsdWarning> = [];
	let outputBytes = 0;
	for (const scenario of corpus.scenarios) {
		const result = await runScenario(scenario.id);
		warnings.push(...result.warnings);
		outputBytes += result.outputBytes;
	}
	return {
		evidence: warningEvidence(
			omittedCode ? warnings.filter(warning => warning.code !== omittedCode) : warnings,
			corpus.scenarios.flatMap(scenario => scenario.expectedWarningCodes),
			corpus.scenarios.length
		),
		outputBytes
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('PSD warning completeness evidence', () => {
	it('covers every consumer warning in the deterministic corpus', async () => {
		const { corpus } = await readCorpus();
		const result = await runCorpus(corpus);
		const expectedCodes = corpus.scenarios
			.flatMap(scenario => scenario.expectedWarningCodes)
			.sort((left, right) => left.localeCompare(right));

		expect(result.evidence).toEqual({
			status: 'PASS',
			scenarioCount: 2,
			outputCount: 10,
			actualCodes: expectedCodes,
			expectedCodes
		});
		expect(result.outputBytes).toBeGreaterThan(0);
		expect(vi.mocked(writePsd)).toHaveBeenCalledOnce();
	});

	it('fails when the seeded defect omits one required adapter warning', async () => {
		const { corpus } = await readCorpus();
		const result = await runCorpus(corpus, 'mask-flattened');

		expect(result.evidence).toMatchObject({
			status: 'FAIL',
			scenarioCount: 2,
			outputCount: 9
		});
	});

	it('pins the corpus contract hash and its typed external-proof boundary', async () => {
		const { raw, corpus } = await readCorpus();

		expect(createHash('sha256').update(raw).digest('hex')).toBe(CORPUS_HASH);
		expect(corpus.scenarios).toHaveLength(2);
		expect(corpus.externalCorpus).toEqual(expect.objectContaining({ status: 'UNKNOWN', files: [] }));
	});
});
