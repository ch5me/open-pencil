import {
	DocumentHistory,
	EDITOR_HISTORY_LIMIT,
	createEditorDocument,
	cropEditorDocument,
	deleteLayer,
	documentCommand,
	duplicateLayer,
	EditorCapabilityError,
	executeImageEdit,
	executePathEdit,
	executeRasterPaint,
	executeSelection,
	executeTextEdit,
	executeShapeEdit,
	findLayer,
	getEditorImageSize,
	moveLayer,
	parseEditorDocument,
	reorderLayer,
	resizeEditorCanvas,
	selectLayer,
	updateLayer,
	updateLayerSelection,
	updateImageLayer,
	type EditorDocument
} from './editor-document';

describe('editor document', () => {
	it('creates a polished nested document with stable unique IDs', () => {
		const document = createEditorDocument();
		expect(document).toMatchObject({ version: 1, width: 960, height: 640, selectedLayerId: 'headline' });
		expect(new Set(document.layers.map(layer => layer.id)).size).toBe(document.layers.length);
		expect(document.layers.map(layer => layer.kind)).toEqual(['text', 'shape', 'group', 'image', 'text', 'image']);
		expect(document.layers.filter(layer => layer.parentId === 'artwork')).toHaveLength(2);
	});

	it('updates immutably without changing identity or kind', () => {
		const before = createEditorDocument();
		const after = updateLayer(before, 'headline', { opacity: 0.4, name: 'New title', rotation: 15 });
		expect(after).not.toBe(before);
		expect(after.layers).not.toBe(before.layers);
		expect(findLayer(after, 'headline')).toMatchObject({
			id: 'headline',
			kind: 'text',
			opacity: 0.4,
			name: 'New title',
			rotation: 15
		});
		expect(findLayer(before, 'headline')).toMatchObject({ opacity: 1, name: 'Night market', rotation: 0 });
		expect(() => updateLayer(before, 'missing', { visible: false })).toThrow('Unknown editor layer');
	});

	it('edits every typed text control as one history transaction', () => {
		const before = createEditorDocument();
		const history = new DocumentHistory(before);
		executeTextEdit(history, 'headline', {
			content: 'Market after dark',
			fontFamily: 'IBM Plex Sans',
			fontSize: 42,
			fontWeight: 600,
			alignment: 'center',
			color: '#ffffff',
			letterSpacing: 1.5,
			lineHeight: 1.4,
			wrapping: 'character'
		});
		expect(history.document).toMatchObject({
			layers: expect.arrayContaining([expect.objectContaining({
				id: 'headline',
				kind: 'text',
				content: 'Market after dark',
				fontFamily: 'IBM Plex Sans',
				fontSize: 42,
				fontWeight: 600,
				alignment: 'center',
				color: '#ffffff',
				letterSpacing: 1.5,
				lineHeight: 1.4,
				wrapping: 'character'
			})])
		});
		expect(history.canUndo).toBe(true);
		history.undo();
		expect(findLayer(history.document, 'headline')).toMatchObject({
			content: 'NIGHT MARKET',
			fontFamily: 'Avenir Next',
			fontWeight: 800,
			alignment: 'left'
		});
		expect(history.canUndo).toBe(false);
	});

	it('reports a stable capability error for non-text layers', () => {
		const error = (() => {
			try {
				executeTextEdit(new DocumentHistory(createEditorDocument()), 'seal', { content: 'Nope' });
				return undefined;
			} catch (error_) {
				return error_;
			}
		})();
		expect(error).toBeInstanceOf(EditorCapabilityError);
		expect(error).toMatchObject({ code: 'E_CAPABILITY_TEXT_EDIT_UNAVAILABLE' });
	});

	it('edits image source, crop, relink, resample, and resolution as one transaction', () => {
		const history = new DocumentHistory(createEditorDocument());
		executeImageEdit(history, 'jade-fan', {
			assetId: 'asset-jade-fan-v2',
			seed: 'jade-fan-relinked',
			sourceWidth: 1200,
			sourceHeight: 800,
			sourceResolution: 144,
			crop: { x: 20, y: 30, width: 900, height: 600 }
		});
		expect(findLayer(history.document, 'jade-fan')).toMatchObject({
			kind: 'image',
			assetId: 'asset-jade-fan-v2',
			seed: 'jade-fan-relinked',
			sourceWidth: 1200,
			sourceHeight: 800,
			sourceResolution: 144,
			crop: { x: 20, y: 30, width: 900, height: 600 }
		});
		history.undo();
		expect(findLayer(history.document, 'jade-fan')).toMatchObject({
			assetId: null,
			sourceWidth: 580,
			sourceHeight: 350,
			sourceResolution: 72,
			crop: null
		});
	});

	it('rejects image edits on non-image layers with a stable capability code', () => {
		expect(() => updateImageLayer(createEditorDocument(), 'headline', { assetId: 'asset' }))
			.toThrow('E_CAPABILITY_IMAGE_EDIT_UNAVAILABLE');
	});

	it.each([
		'brush',
		'eraser',
		'clone-stamp',
		'healing',
		'dodge',
		'burn',
		'smudge',
		'blur',
		'sharpen',
		'fill-bucket',
		'gradient'
	] as const)('keeps raster tool %s as a typed capability gap without creating a history transaction', tool => {
		const history = new DocumentHistory(createEditorDocument());
		const before = history.document;
		expect(() => executeRasterPaint(history, {
			layerId: 'jade-fan',
			tool,
			x: 120,
			y: 80,
			radius: 12,
			opacity: 0.75,
			color: '#ffffff'
		})).toThrow('E_CAPABILITY_RASTER_PAINT_UNAVAILABLE');
		expect(history.document).toBe(before);
		expect(history.canUndo).toBe(false);
	});

	it('reports raster paint capability consistently for semantic non-image targets', () => {
		const error = (() => {
			try {
				executeRasterPaint(new DocumentHistory(createEditorDocument()), {
					layerId: 'headline',
					tool: 'eraser',
					x: 0,
					y: 0,
					radius: 8,
					opacity: 1
				});
				return undefined;
			} catch (error_) {
				return error_;
			}
		})();
		expect(error).toBeInstanceOf(EditorCapabilityError);
		expect(error).toMatchObject({ code: 'E_CAPABILITY_RASTER_PAINT_UNAVAILABLE' });
	});

	it.each([
		'marquee',
		'lasso',
		'polygon',
		'magic-wand',
		'subject',
		'background'
	] as const)('keeps %s selection as a typed capability gap without creating a history transaction', tool => {
		const history = new DocumentHistory(createEditorDocument());
		const before = history.document;
		expect(() => executeSelection(history, {
			layerId: 'jade-fan',
			tool,
			x: 120,
			y: 80
		})).toThrow('E_CAPABILITY_SELECTION_UNAVAILABLE');
		expect(history.document).toBe(before);
		expect(history.canUndo).toBe(false);
	});

	it('reports selection capability consistently for semantic non-image targets', () => {
		const error = (() => {
			try {
				executeSelection(new DocumentHistory(createEditorDocument()), {
					layerId: 'headline',
					tool: 'subject',
					x: 0,
					y: 0
				});
				return undefined;
			} catch (error_) {
				return error_;
			}
		})();
		expect(error).toBeInstanceOf(EditorCapabilityError);
		expect(error).toMatchObject({ code: 'E_CAPABILITY_SELECTION_UNAVAILABLE' });
	});

	it.each(['pen', 'anchor'] as const)(
		'keeps %s path editing as a typed capability gap without creating a history transaction',
		tool => {
			const history = new DocumentHistory(createEditorDocument());
			const before = history.document;
			expect(() => executePathEdit(history, {
				layerId: 'seal',
				tool,
				x: 120,
				y: 80,
				anchorIndex: 0
			})).toThrow('E_CAPABILITY_PATH_EDIT_UNAVAILABLE');
			expect(history.document).toBe(before);
			expect(history.canUndo).toBe(false);
		}
	);

	it('preserves the selected content layer through path failure and save/reopen', () => {
		const history = new DocumentHistory(createEditorDocument());
		const before = history.document;
		expect(() => executePathEdit(history, {
			layerId: 'seal',
			tool: 'anchor',
			anchorIndex: 0
		})).toThrow('E_CAPABILITY_PATH_EDIT_UNAVAILABLE');
		const reopened = parseEditorDocument(JSON.stringify(history.document));
		expect(reopened.selectedLayerId).toBe('headline');
		expect(reopened).toEqual(before);
	});

	it('preserves the selected content layer through selection failure and save/reopen', () => {
		const history = new DocumentHistory(createEditorDocument());
		const before = history.document;
		expect(() => executeSelection(history, {
			layerId: 'jade-fan',
			tool: 'marquee'
		})).toThrow('E_CAPABILITY_SELECTION_UNAVAILABLE');
		const reopened = parseEditorDocument(JSON.stringify(history.document));
		expect(reopened.selectedLayerId).toBe('headline');
		expect(reopened).toEqual(before);
	});

	it('rejects crops outside the image source', () => {
		expect(() => updateImageLayer(createEditorDocument(), 'jade-fan', {
			crop: { x: 0, y: 0, width: 581, height: 350 }
		})).toThrow('inside the source');
	});

	it('edits shape form, geometry, paint, corners, and path as one transaction', () => {
		const history = new DocumentHistory(createEditorDocument());
		executeShapeEdit(history, 'seal', {
			form: 'rectangle',
			fill: '#112233',
			stroke: '#ddeeff',
			cornerRadius: 24,
			path: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }]
		});
		expect(findLayer(history.document, 'seal')).toMatchObject({
			kind: 'shape',
			form: 'rectangle',
			fill: '#112233',
			stroke: '#ddeeff',
			cornerRadius: 24,
			path: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }]
		});
		history.undo();
		expect(findLayer(history.document, 'seal')).toMatchObject({ form: 'rectangle', fill: '#c94432', cornerRadius: 12, path: [] });
	});

	it('reports a stable capability error for shape edits on non-shape layers', () => {
		const error = (() => {
			try {
				executeShapeEdit(new DocumentHistory(createEditorDocument()), 'headline', { fill: '#fff' });
				return undefined;
			} catch (error_) {
				return error_;
			}
		})();
		expect(error).toMatchObject({ code: 'E_CAPABILITY_SHAPE_EDIT_UNAVAILABLE' });
	});

	it('duplicates a group and its children with remapped parents', () => {
		const before = createEditorDocument();
		const result = duplicateLayer(before, 'artwork');
		expect(result.selectedLayerId).toBe('artwork-copy');
		expect(result.document.selectedLayerId).toBe('artwork-copy');
		expect(result.document.layers.slice(5, 8).map(layer => [layer.id, layer.parentId])).toEqual([
			['artwork-copy', null],
			['jade-fan-copy', 'artwork-copy'],
			['caption-copy', 'artwork-copy']
		]);
		expect(before.layers).toHaveLength(6);
	});

	it('deletes a whole nested group and selects the nearest remaining row', () => {
		const result = deleteLayer(createEditorDocument(), 'artwork');
		expect(result.layers.map(layer => layer.id)).toEqual(['headline', 'seal', 'paper']);
		expect(result.selectedLayerId).toBe('paper');
	});

	it('reorders subtrees, reparents rows, and rejects cycles or invalid destinations', () => {
		const before = createEditorDocument();
		const moved = reorderLayer(before, 'artwork', 'headline', null);
		expect(moved.layers.slice(0, 4).map(layer => layer.id)).toEqual(['artwork', 'jade-fan', 'caption', 'headline']);
		const nested = reorderLayer(before, 'seal', null, 'artwork');
		expect(nested.layers.at(-1)?.id).toBe('paper');
		expect(findLayer(nested, 'seal')?.parentId).toBe('artwork');
		expect(() => reorderLayer(before, 'artwork', null, 'artwork')).toThrow('own subtree');
		expect(() => reorderLayer(before, 'headline', null, 'paper')).toThrow('not a group');
		expect(() => reorderLayer(before, 'missing', null, null)).toThrow('Unknown editor layer');
	});

	it('moves nested subtrees before, inside, or after while preserving selection', () => {
		const before = createEditorDocument();
		const beforeGroup = moveLayer(before, 'paper', 'artwork', 'before');
		expect(beforeGroup.layers.map(layer => layer.id)).toEqual([
			'headline',
			'seal',
			'paper',
			'artwork',
			'jade-fan',
			'caption'
		]);
		const insideGroup = moveLayer(before, 'seal', 'artwork', 'inside');
		expect(insideGroup.layers.map(layer => layer.id)).toEqual([
			'headline',
			'artwork',
			'jade-fan',
			'caption',
			'seal',
			'paper'
		]);
		expect(findLayer(insideGroup, 'seal')?.parentId).toBe('artwork');
		const afterGroup = moveLayer(before, 'headline', 'artwork', 'after');
		expect(afterGroup.layers.map(layer => layer.id)).toEqual([
			'seal',
			'artwork',
			'jade-fan',
			'caption',
			'headline',
			'paper'
		]);
		expect(afterGroup.selectedLayerId).toBe(before.selectedLayerId);
	});

	it('rejects cyclic, locked, and invalid nested moves', () => {
		const before = createEditorDocument();
		expect(() => moveLayer(before, 'artwork', 'jade-fan', 'inside')).toThrow('own subtree');
		expect(() => moveLayer(before, 'paper', 'headline', 'inside')).toThrow('not a group');
		expect(() => moveLayer(before, 'paper', 'missing', 'before')).toThrow('Unknown editor layer target');
		const lockedSource = updateLayer(before, 'paper', { locked: true });
		expect(() => moveLayer(lockedSource, 'paper', 'headline', 'before')).toThrow('locked editor layer');
		const lockedTarget = updateLayer(before, 'artwork', { locked: true });
		expect(() => moveLayer(lockedTarget, 'paper', 'jade-fan', 'before')).toThrow('locked editor layer');
	});

	it('crops the canvas and shifts renderable layers into the crop space', () => {
		const before = createEditorDocument();
		const after = cropEditorDocument(before, { x: 80, y: 60, width: 400, height: 300 });
		expect(getEditorImageSize(after)).toEqual({ width: 400, height: 300 });
		expect(findLayer(after, 'headline')).toMatchObject({ bounds: { x: 6, y: 12 } });
		expect(findLayer(after, 'artwork')).toMatchObject({ kind: 'group' });
		expect(before.width).toBe(960);
	});

	it('resizes the canvas using an anchor and can preserve or discard content offset', () => {
		const before = createEditorDocument();
		const centered = resizeEditorCanvas(before, 1000, 800);
		expect(findLayer(centered, 'headline')).toMatchObject({ bounds: { x: 106, y: 152 } });
		const topLeft = resizeEditorCanvas(before, 1000, 800, { anchor: 'top-left' });
		expect(findLayer(topLeft, 'headline')).toMatchObject({ bounds: { x: 86, y: 72 } });
		const reset = resizeEditorCanvas(before, 1000, 800, { preserveContent: false });
		expect(findLayer(reset, 'headline')).toMatchObject({ bounds: { x: 86, y: 72 } });
	});

	it('rejects invalid canvas and crop geometry', () => {
		const document = createEditorDocument();
		expect(() => resizeEditorCanvas(document, 0, 100)).toThrow('Canvas size');
		expect(() => resizeEditorCanvas(document, 1.5, 100)).toThrow('Canvas size');
		expect(() => cropEditorDocument(document, { x: -1, y: 0, width: 10, height: 10 })).toThrow('Crop rectangle');
		expect(() => cropEditorDocument(document, { x: 0, y: 0, width: 961, height: 10 })).toThrow('Crop rectangle');
	});

	it('keeps resize deterministic across a representative corpus', () => {
		const document = createEditorDocument();
		for (let index = 0; index < 256; index += 1) {
			const width = 1 + (index % 8192);
			const maxHeight = Math.min(8192, Math.floor(67_108_864 / width));
			const height = 1 + ((index * 17) % maxHeight);
			const resized = resizeEditorCanvas(document, width, height, { anchor: 'top-left' });
			expect(getEditorImageSize(resized)).toEqual({ width, height });
			expect(findLayer(resized, 'headline')).toMatchObject({ bounds: { x: 86 } });
		}
	});
});

describe('editor document JSON validation', () => {
	const plain = (): Record<string, unknown> => structuredClone(createEditorDocument()) as unknown as Record<string, unknown>;

	it('preserves only known typed fields', () => {
		const input = plain();
		input.extra = 'discard';
		const layers = input.layers as Array<Record<string, unknown>>;
		layers[0].extra = 'discard';
		const parsed = parseEditorDocument(JSON.stringify(input));
		expect(parsed).toEqual(createEditorDocument());
		expect(parsed).not.toHaveProperty('extra');
		expect(parsed.layers[0]).not.toHaveProperty('extra');
	});

	it('parses old version 1 documents with new metadata defaults and round-trips them', () => {
		const input = plain();
		const layers = input.layers as Array<Record<string, unknown>>;
		for (const layer of layers) {
			delete layer.maskAssetId;
			delete layer.rotation;
			delete layer.assetId;
		}
		layers[0].maskEnabled = true;
		const parsed = parseEditorDocument(input);
		expect(parsed.layers.every(layer => layer.maskAssetId === null)).toBe(true);
		expect(parsed.layers[0].maskEnabled).toBe(true);
		expect(parsed.layers.filter(layer => layer.kind === 'image').every(layer => layer.assetId === null)).toBe(true);
		expect(parsed.layers.filter(layer => ['image', 'text', 'shape'].includes(layer.kind)).every(
			layer => 'rotation' in layer && layer.rotation === 0
		)).toBe(true);
		expect(parseEditorDocument(JSON.stringify(parsed))).toEqual(parsed);
	});

	it('parses adjustment layers without bounds', () => {
		const input = plain();
		const layers = input.layers as Array<Record<string, unknown>>;
		layers.push({
			...layers[2],
			id: 'color-grade',
			name: 'Color grade',
			kind: 'adjustment',
			parentId: null,
			adjustments: { brightness: 12, contrast: -8, saturation: 25, blur: 2 },
			bounds: { x: 0, y: 0, width: 1, height: 1 }
		});
		input.selectedLayerId = 'color-grade';
		const parsed = parseEditorDocument(input);
		expect(findLayer(parsed, 'color-grade')).toEqual({
			id: 'color-grade',
			name: 'Color grade',
			kind: 'adjustment',
			visible: true,
			locked: false,
			opacity: 1,
			blendMode: 'normal',
			parentId: null,
			maskEnabled: false,
			maskAssetId: null,
			clipped: false,
			adjustments: { brightness: 12, contrast: -8, saturation: 25, blur: 2 }
		});
		expect(findLayer(duplicateLayer(parsed, 'color-grade').document, 'color-grade-copy')).toMatchObject({
			kind: 'adjustment',
			adjustments: { brightness: 12, contrast: -8, saturation: 25, blur: 2 }
		});
	});

	it('round-trips stable image and mask asset references', () => {
		const input = plain();
		const layers = input.layers as Array<Record<string, unknown>>;
		const image = layers.find(layer => layer.id === 'jade-fan');
		expect(image).toBeDefined();
		if (!image) {
			throw new Error('Expected jade-fan image layer');
		}
		image.assetId = 'asset-jade-fan';
		image.maskEnabled = true;
		image.maskAssetId = 'asset-jade-mask';
		image.rotation = 27;
		const parsed = parseEditorDocument(JSON.stringify(input));
		expect(findLayer(parsed, 'jade-fan')).toMatchObject({
			assetId: 'asset-jade-fan',
			maskEnabled: true,
			maskAssetId: 'asset-jade-mask',
			rotation: 27
		});
		const duplicate = duplicateLayer(parsed, 'jade-fan').document;
		expect(findLayer(duplicate, 'jade-fan-copy')).toMatchObject({
			assetId: 'asset-jade-fan',
			maskEnabled: true,
			maskAssetId: 'asset-jade-mask',
			rotation: 27
		});
	});

	it('preserves editable text controls through save and reopen', () => {
		const history = new DocumentHistory(createEditorDocument());
		executeTextEdit(history, 'headline', {
			content: 'Reopened title',
			fontFamily: 'Georgia',
			fontWeight: 700,
			alignment: 'right',
			letterSpacing: 2,
			lineHeight: 1.6,
			wrapping: 'none'
		});
		const reopened = parseEditorDocument(JSON.stringify(history.document));
		expect(findLayer(reopened, 'headline')).toMatchObject({
			kind: 'text',
			content: 'Reopened title',
			fontFamily: 'Georgia',
			fontWeight: 700,
			alignment: 'right',
			letterSpacing: 2,
			lineHeight: 1.6,
			wrapping: 'none'
		});
	});

	it('preserves editable shape controls through save and reopen', () => {
		const document = updateLayer(createEditorDocument(), 'seal', {
			form: 'rectangle',
			fill: '#123456',
			stroke: '#abcdef',
			cornerRadius: 31,
			path: [{ x: 0.05, y: 0.15 }, { x: 0.95, y: 0.2 }, { x: 0.5, y: 0.9 }]
		});
		const reopened = parseEditorDocument(JSON.stringify(document));
		expect(findLayer(reopened, 'seal')).toMatchObject({
			kind: 'shape',
			form: 'rectangle',
			fill: '#123456',
			stroke: '#abcdef',
			cornerRadius: 31,
			path: [{ x: 0.05, y: 0.15 }, { x: 0.95, y: 0.2 }, { x: 0.5, y: 0.9 }]
		});
	});

	it('accepts bounded rotations and rejects values outside the model range', () => {
		const upper = plain();
		(upper.layers as Array<Record<string, unknown>>)[0].rotation = 360;
		expect(findLayer(parseEditorDocument(upper), 'headline')).toMatchObject({ rotation: 360 });
		const tooHigh = plain();
		(tooHigh.layers as Array<Record<string, unknown>>)[0].rotation = 360.01;
		expect(() => parseEditorDocument(tooHigh)).toThrow('layer rotation');
		const tooLow = plain();
		(tooLow.layers as Array<Record<string, unknown>>)[0].rotation = -360.01;
		expect(() => parseEditorDocument(tooLow)).toThrow('layer rotation');
	});

	it.each([
		['unsupported version', (value: Record<string, unknown>) => {
			value.version = 2;
		}],
		['bad dimensions', (value: Record<string, unknown>) => {
			value.width = 0;
		}],
		['oversized document', (value: Record<string, unknown>) => {
			value.width = 8192;
			value.height = 8192;
			(value.layers as Array<Record<string, unknown>>)[0].bounds = { x: 0, y: 0, width: 8192, height: 8192 };
		}],
		['too many layers', (value: Record<string, unknown>) => {
			const layer = (value.layers as Array<Record<string, unknown>>)[0];
			value.layers = Array.from({ length: 513 }, (_, index) => ({ ...structuredClone(layer), id: `layer-${index}` }));
			value.selectedLayerId = 'layer-0';
		}],
		['duplicate IDs', (value: Record<string, unknown>) => {
			const layers = value.layers as Array<Record<string, unknown>>;
			layers[1].id = layers[0].id;
		}],
		['missing parents', (value: Record<string, unknown>) => {
			const layers = value.layers as Array<Record<string, unknown>>;
			layers[3].parentId = 'missing';
		}],
		['non-group parents', (value: Record<string, unknown>) => {
			const layers = value.layers as Array<Record<string, unknown>>;
			layers[3].parentId = 'headline';
		}],
		['invalid selection', (value: Record<string, unknown>) => {
			value.selectedLayerId = 'missing';
		}],
		['bad bounds', (value: Record<string, unknown>) => {
			const layers = value.layers as Array<Record<string, unknown>>;
			(layers[0].bounds as Record<string, unknown>).width = -1;
		}],
		['bad controls', (value: Record<string, unknown>) => {
			const layers = value.layers as Array<Record<string, unknown>>;
			layers[0].opacity = 2;
		}],
		['bad payload', (value: Record<string, unknown>) => {
			const layers = value.layers as Array<Record<string, unknown>>;
			layers[0].fontSize = 0;
		}],
		['bad mask asset', (value: Record<string, unknown>) => {
			const layers = value.layers as Array<Record<string, unknown>>;
			layers[0].maskAssetId = '';
		}],
		['bad image asset', (value: Record<string, unknown>) => {
			const layers = value.layers as Array<Record<string, unknown>>;
			layers[3].assetId = '';
		}]
	])('rejects %s', (_name, mutate) => {
		const input = plain();
		mutate(input);
		expect(() => parseEditorDocument(input)).toThrow('Invalid editor document');
	});
});

describe('document history', () => {
	const renamed = (document: EditorDocument, name: string): EditorDocument => updateLayer(document, 'headline', { name });

	it('executes, undoes, redoes, and resets explicit before/after commands', () => {
		const first = createEditorDocument();
		const second = renamed(first, 'Second');
		const history = new DocumentHistory(first);
		history.execute(documentCommand('Rename', first, second));
		expect(history.document).toBe(second);
		expect(history.canUndo).toBe(true);
		history.undo();
		expect(history.document).toBe(first);
		expect(history.canRedo).toBe(true);
		history.redo();
		expect(history.document).toBe(second);
		history.reset(first);
		expect(history.document).toBe(first);
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
	});

	it('clears redo after a new command', () => {
		const first = createEditorDocument();
		const second = renamed(first, 'Second');
		const third = renamed(first, 'Third');
		const history = new DocumentHistory(first);
		history.execute(documentCommand('Second', first, second));
		history.undo();
		history.execute(documentCommand('Third', first, third));
		expect(history.canRedo).toBe(false);
		expect(history.document).toBe(third);
	});

	it('restores transaction-owned bytes through undo and redo', () => {
		const document = createEditorDocument();
		const history = new DocumentHistory(document);
		let bytes = new Uint8ClampedArray([0, 64, 128, 255]);
		const before = bytes.slice();
		bytes = new Uint8ClampedArray([255, 128, 64, 0]);
		const after = bytes.slice();

		history.execute(documentCommand('Paint mask', document, document, {
			undoEffect: () => {
				bytes = before.slice();
			},
			redoEffect: () => {
				bytes = after.slice();
			}
		}));

		history.undo();
		expect(bytes).toEqual(before);
		expect(history.document).toBe(document);
		history.redo();
		expect(bytes).toEqual(after);
		expect(history.document).toBe(document);
	});

	it('updates layer selection without changing undo or redo stacks', () => {
		const first = createEditorDocument();
		const history = new DocumentHistory(first);

		updateLayerSelection(history, 'jade-fan');
		expect(history.document.selectedLayerId).toBe('jade-fan');
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);

		history.undo();
		expect(history.document.selectedLayerId).toBe('jade-fan');
		history.redo();
		expect(history.document.selectedLayerId).toBe('jade-fan');

		updateLayerSelection(history, null);
		expect(history.document.selectedLayerId).toBeNull();
		history.undo();
		expect(history.document.selectedLayerId).toBeNull();
	});

	it('rejects an unknown selection without changing document history', () => {
		const history = new DocumentHistory(createEditorDocument());
		updateLayerSelection(history, 'headline');
		expect(history.canUndo).toBe(false);
		expect(() => updateLayerSelection(history, 'missing')).toThrow('Unknown editor layer');
		expect(history.document.selectedLayerId).toBe('headline');
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
	});

	it('keeps the active selection through content undo and redo while valid', () => {
		const first = createEditorDocument();
		const second = renamed(first, 'Second');
		const history = new DocumentHistory(first);
		history.execute(documentCommand('Rename', first, second));

		updateLayerSelection(history, 'jade-fan');
		history.undo();
		expect(findLayer(history.document, 'headline')?.name).toBe('Night market');
		expect(history.document.selectedLayerId).toBe('jade-fan');
		history.redo();
		expect(findLayer(history.document, 'headline')?.name).toBe('Second');
		expect(history.document.selectedLayerId).toBe('jade-fan');
	});

	it('falls back to command selection when the active layer is absent', () => {
		const first = createEditorDocument();
		const second = deleteLayer(first, 'jade-fan');
		const history = new DocumentHistory(first);
		history.execute(documentCommand('Delete Jade fan', first, second));
		updateLayerSelection(history, 'paper');

		history.undo();
		updateLayerSelection(history, 'jade-fan');
		history.redo();
		expect(history.document.selectedLayerId).toBe(second.selectedLayerId);
		expect(findLayer(history.document, history.document.selectedLayerId ?? '')).toBeDefined();
	});

	it('persists selection without serializing history stacks', () => {
		const first = createEditorDocument();
		const history = new DocumentHistory(first);
		const second = renamed(first, 'Saved content');
		history.execute(documentCommand('Rename', first, second));
		updateLayerSelection(history, 'jade-fan');

		const reopened = new DocumentHistory(parseEditorDocument(JSON.stringify(history.document)));
		expect(reopened.document).toEqual(selectLayer(second, 'jade-fan'));
		expect(reopened.canUndo).toBe(false);
		expect(reopened.canRedo).toBe(false);
	});

	it('rejects commands based on stale document state', () => {
		const first = createEditorDocument();
		const second = renamed(first, 'Second');
		const history = new DocumentHistory(first);
		history.execute(documentCommand('Second', first, second));
		expect(() => history.execute(documentCommand('Stale', first, renamed(first, 'Stale')))).toThrow(
			'must start from the current document'
		);
	});

	it('bounds undo history to the configured limit', () => {
		const first = createEditorDocument();
		const second = renamed(first, 'Second');
		const third = renamed(second, 'Third');
		const fourth = renamed(third, 'Fourth');
		const history = new DocumentHistory(first, 2);
		history.execute(documentCommand('Second', first, second));
		history.execute(documentCommand('Third', second, third));
		history.execute(documentCommand('Fourth', third, fourth));
		history.undo();
		history.undo();
		history.undo();
		expect(history.document).toBe(second);
		expect(history.canUndo).toBe(false);
	});

	it('retains 50 metadata transactions and drops only the oldest boundary', () => {
		const first = createEditorDocument();
		const history = new DocumentHistory(first);

		for (let index = 1; index <= EDITOR_HISTORY_LIMIT + 1; index++) {
			const before = history.document;
			const after = updateLayer(before, 'headline', { name: `Revision ${index}` });
			history.execute(documentCommand(`Rename ${index}`, before, after));
		}

		for (let index = 0; index < EDITOR_HISTORY_LIMIT; index++) {
			history.undo();
		}
		expect(history.document).toMatchObject({
			layers: expect.arrayContaining([expect.objectContaining({ id: 'headline', name: 'Revision 1' })])
		});
		expect(history.canUndo).toBe(false);
		history.redo();
		expect(history.document).toMatchObject({
			layers: expect.arrayContaining([expect.objectContaining({ id: 'headline', name: 'Revision 2' })])
		});
	});
});
