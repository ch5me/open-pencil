import {
	duplicateLayer,
	updateLayer,
	type DocumentHistory,
	type EditorDocument
} from './editor-document';

export interface EditorAssetLifecycle {
	duplicateAsset(id: string): string;
	removeAsset(id: string): void;
	collectGarbage(referencedIds: Iterable<string>): ReadonlyArray<string>;
}

export function referencedEditorAssetIds(document: EditorDocument): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const layer of document.layers) {
		if ('assetId' in layer && layer.assetId) {
			ids.add(layer.assetId);
		}
		if (layer.maskAssetId) {
			ids.add(layer.maskAssetId);
		}
	}
	return ids;
}

export function duplicateLayerWithAssets(
	document: EditorDocument,
	id: string,
	assets: EditorAssetLifecycle
): { document: EditorDocument; selectedLayerId: string } {
	const duplicated = duplicateLayer(document, id);
	const existingLayerIds = new Set(document.layers.map(layer => layer.id));
	const createdAssetIds: Array<string> = [];
	let next = duplicated.document;
	try {
		for (const layer of duplicated.document.layers) {
			if (existingLayerIds.has(layer.id) || !layer.maskAssetId) {
				continue;
			}
			const maskAssetId = assets.duplicateAsset(layer.maskAssetId);
			createdAssetIds.push(maskAssetId);
			next = updateLayer(next, layer.id, { maskAssetId });
		}
	} catch (error) {
		for (const assetId of createdAssetIds.reverse()) {
			assets.removeAsset(assetId);
		}
		throw error;
	}
	return { ...duplicated, document: next };
}

export function collectHistoryAssetGarbage(
	history: DocumentHistory,
	assets: EditorAssetLifecycle
): ReadonlyArray<string> {
	const referenced = new Set<string>();
	for (const document of history.retainedDocuments) {
		for (const id of referencedEditorAssetIds(document)) {
			referenced.add(id);
		}
	}
	return assets.collectGarbage(referenced);
}
