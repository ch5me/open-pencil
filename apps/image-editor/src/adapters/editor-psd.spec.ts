import { readPsd } from 'ag-psd';
import { describe, expect, it, vi } from 'vitest';
import { importPsd, PsdImportError } from './editor-psd';
import { DocumentHistory, executeTextEdit, parseEditorDocument } from '../model/editor-document';
import type { EditorAssetRegistry } from '../rendering/editor-asset-registry';

vi.mock('ag-psd', () => ({
	readPsd: vi.fn(),
	writePsd: vi.fn()
}));

describe('PSD editor adapter', () => {
	it('surfaces corrupt PSD containers as a typed failure', async () => {
		vi.mocked(readPsd).mockImplementation(() => {
			throw new Error('truncated PSD header');
		});

		let caught: unknown;
		try {
			await importPsd(new ArrayBuffer(0), {} as EditorAssetRegistry);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(PsdImportError);
		expect(caught).toMatchObject({ code: 'E_PSD_IMPORT_CORRUPT' });
	});

	it('isolates a corrupt layer and keeps valid sibling layers importable', async () => {
		vi.mocked(readPsd).mockReturnValue({
			width: 640,
			height: 360,
			children: [
				{ name: 'Corrupt layer', text: { ...({} as { text: string }), style: {} } },
				{
					name: 'Valid title',
					left: 40,
					top: 24,
					right: 440,
					bottom: 104,
					text: {
						text: 'OPEN AFTER DARK',
						shapeType: 'box',
						style: { font: { name: 'Inter' }, fontSize: 48 },
						paragraphStyle: { justification: 'justify-center' }
					}
				}
			]
		});
		const registry = { registerCanvas: vi.fn(), removeAsset: vi.fn() } as unknown as EditorAssetRegistry;

		const imported = await importPsd(new ArrayBuffer(0), registry);

		expect(imported.document.layers).toHaveLength(2);
		expect(imported.document.layers[0]).toMatchObject({ kind: 'group', name: 'PSD layer 1' });
		expect(imported.document.layers[1]).toMatchObject({ kind: 'text', name: 'Valid title' });
		expect(imported.warnings).toContainEqual(expect.objectContaining({
			code: 'corrupt-asset-isolated',
			layerId: 'psd-1'
		}));
	});

	it('keeps PSD text as an editable semantic node through save and reopen', async () => {
		vi.mocked(readPsd).mockReturnValue({
			width: 640,
			height: 360,
			children: [{
				name: 'Poster title',
				left: 40,
				top: 24,
				right: 440,
				bottom: 104,
				text: {
					text: 'OPEN AFTER DARK',
					shapeType: 'box',
					style: {
						font: { name: 'Inter' },
						fontSize: 48,
						fauxBold: true,
						tracking: 40,
						fillColor: { r: 240, g: 220, b: 170 }
					},
					paragraphStyle: { justification: 'justify-center' }
				}
			}]
		});
		const registry = { registerCanvas: vi.fn() } as unknown as EditorAssetRegistry;

		const imported = await importPsd(new ArrayBuffer(0), registry);
		const text = imported.document.layers[0];
		expect(text).toMatchObject({
			kind: 'text',
			content: 'OPEN AFTER DARK',
			fontFamily: 'Inter',
			fontSize: 48,
			fontWeight: 700,
			alignment: 'center',
			letterSpacing: 1.92,
			color: '#f0dcaa',
			wrapping: 'word'
		});
		expect(imported.warnings).toEqual([]);

		const reopened = parseEditorDocument(structuredClone(imported.document));
		const history = new DocumentHistory(reopened);
		executeTextEdit(history, 'psd-1', { content: 'EDITED TITLE' });
		expect(history.document.layers[0]).toMatchObject({
			kind: 'text',
			content: 'EDITED TITLE'
		});
		expect(history.canUndo).toBe(true);
	});
});
