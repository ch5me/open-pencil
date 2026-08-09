import type { AssetId } from "#core/editor/assets";
import type { ContentRevisionId } from "#core/editor/history/journal";

export const IMAGE_EDITOR_DATABASE = "openpencil-image-editor-v1";
export const IMAGE_EDITOR_OBJECT_STORE = "records";

export const storageKeys = {
  assetBinding: (documentId: string, assetId: AssetId) =>
    `doc/${documentId}/asset/${assetId}/binding`,
  contentHead: (documentId: string) => `doc/${documentId}/head/content`,
  contentRevision: (revisionId: ContentRevisionId) => `blob/${revisionId}/meta`,
  journal: (documentId: string, sequence: number) =>
    `doc/${documentId}/journal/content/${sequence}`,
  transaction: (transactionId: string) => `tx/${transactionId}/meta`,
} as const;
