export interface ContentVersion {
  readonly sequence: number;
  readonly contentRootHash: string;
}

export interface ViewVersion {
  readonly sequence: number;
  readonly viewRootHash: string;
}

export type ContentJournalStatus =
  | "validating"
  | "staging"
  | "prepared"
  | "committing"
  | "committed"
  | "publishing"
  | "published"
  | "rolling-back"
  | "rolled-back";

export type ViewJournalStatus = "prepared" | "committed" | "published" | "rolled-back";

export type TransactionId = `tx:${string}`;
export type ViewTransactionId = `view-tx:${string}`;
export type ContentRevisionId = `sha256:${string}`;

export interface ContentRevisionRef {
  readonly revisionId: ContentRevisionId;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly byteLength: number;
  readonly sha256: string;
  readonly temporary: boolean;
}

export interface ContentMaskHash {
  readonly maskId: string;
  readonly byteHash: ContentRevisionId;
}

export interface ContentSnapshot {
  readonly contentRootHash: string;
  readonly maskHashes: readonly ContentMaskHash[];
}

export interface ContentSnapshotTransition {
  readonly base: ContentSnapshot;
  readonly next: ContentSnapshot;
}

export interface HistoryPin {
  readonly pinId: string;
  readonly kind: string;
  readonly revisionIds: readonly ContentRevisionId[];
}

export interface ContentJournalEntry {
  readonly transactionId: TransactionId;
  readonly journalSequence: number;
  readonly baseContentVersion: ContentVersion;
  readonly nextContentVersion: ContentVersion;
  readonly baseContentSnapshot: ContentSnapshot;
  readonly nextContentSnapshot: ContentSnapshot;
  readonly contractHash: string;
  readonly authorityMatrixHash: string;
  readonly capabilityVersions: readonly string[];
  readonly forwardOps: readonly unknown[];
  readonly inverseOps: readonly unknown[];
  readonly stagedContentRevisions: readonly ContentRevisionRef[];
  readonly releasedContentRevisions: readonly ContentRevisionId[];
  readonly historyPinsAdded: readonly HistoryPin[];
  readonly historyPinsReleased: readonly string[];
  readonly persistedHistoryByteDelta: number;
  readonly status: ContentJournalStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ViewJournalEntry {
  readonly viewTransactionId: ViewTransactionId;
  readonly baseViewVersion: ViewVersion;
  readonly nextViewVersion: ViewVersion;
  readonly viewOps: readonly unknown[];
  readonly status: ViewJournalStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}
