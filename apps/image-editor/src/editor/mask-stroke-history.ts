import {
	DocumentHistory,
	documentCommand,
	findLayer,
	type EditorDocument,
	type EditorLayer
} from '../model/editor-document';
import type { EditorMaskSnapshot } from '../rendering/editor-asset-registry';

export interface MaskSnapshotStore {
	snapshotMask(id: string): EditorMaskSnapshot;
	restoreMask(snapshot: EditorMaskSnapshot): void;
}

interface ActiveMaskStroke {
	readonly pointerId: number;
	readonly document: EditorDocument;
	readonly layerId: string;
	readonly assetId: string;
	readonly before: EditorMaskSnapshot;
	painted: boolean;
}

export type MaskStrokeStart = 'started' | 'coalesced' | 'cancelled' | 'rejected';

export interface MaskStrokeBinding {
	readonly assetId: string;
	readonly layer: EditorLayer;
}

function equalBytes(left: Uint8ClampedArray, right: Uint8ClampedArray): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class MaskStrokeHistory {
	private active: ActiveMaskStroke | null = null;

	constructor(private readonly assets: MaskSnapshotStore) {}

	start(pointerId: number, document: EditorDocument, layerId: string, assetId: string): MaskStrokeStart {
		if (this.active?.pointerId === pointerId) {
			return 'coalesced';
		}
		if (this.active) {
			this.cancel();
			return 'cancelled';
		}
		const layer = findLayer(document, layerId);
		if (!layer || !layer.maskEnabled || layer.maskAssetId !== assetId) {
			return 'rejected';
		}
		this.active = {
			pointerId,
			document,
			layerId,
			assetId,
			before: this.assets.snapshotMask(assetId),
			painted: false
		};
		return 'started';
	}

	markPainted(pointerId: number, painted: boolean): void {
		if (painted && this.active?.pointerId === pointerId) {
			this.active.painted = true;
		}
	}

	binding(pointerId: number): MaskStrokeBinding | null {
		const stroke = this.active;
		if (!stroke || stroke.pointerId !== pointerId) {
			return null;
		}
		const layer = findLayer(stroke.document, stroke.layerId);
		return layer ? { assetId: stroke.assetId, layer } : null;
	}

	finish(pointerId: number, history: DocumentHistory): boolean {
		if (this.active?.pointerId !== pointerId) {
			return false;
		}
		return this.finalize(history);
	}

	finalize(history: DocumentHistory): boolean {
		const stroke = this.active;
		this.active = null;
		if (!stroke?.painted) {
			return false;
		}
		if (history.document !== stroke.document) {
			this.restore(stroke.before);
			return false;
		}
		const layer = findLayer(stroke.document, stroke.layerId);
		if (!layer || !layer.maskEnabled || layer.maskAssetId !== stroke.assetId) {
			this.restore(stroke.before);
			return false;
		}
		const after = this.assets.snapshotMask(stroke.assetId);
		if (equalBytes(stroke.before.bytes, after.bytes)) {
			return false;
		}
		history.execute(documentCommand('Paint mask', stroke.document, stroke.document, {
			undoEffect: () => this.assets.restoreMask(stroke.before),
			redoEffect: () => this.assets.restoreMask(after)
		}));
		return true;
	}

	cancel(pointerId?: number): boolean {
		const stroke = this.active;
		if (!stroke || (pointerId !== undefined && stroke.pointerId !== pointerId)) {
			return false;
		}
		this.active = null;
		if (stroke.painted) {
			this.restore(stroke.before);
		}
		return stroke.painted;
	}

	private restore(snapshot: EditorMaskSnapshot): void {
		this.assets.restoreMask(snapshot);
	}
}
