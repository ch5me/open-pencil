import type {
  ContentJournalEntry,
  ContentVersion,
  ContentRevisionId,
} from "#core/editor/history/journal";

export interface StagedChunk {
  readonly transactionId: string;
  readonly chunkIndex: number;
  readonly byteLength: number;
  readonly sha256: string;
  readonly final: boolean;
  readonly bytes: Uint8Array;
}

export interface ContentCommit {
  readonly documentId: string;
  readonly journal: ContentJournalEntry;
  readonly nextHead: ContentVersion;
  readonly revisions: readonly ContentRevisionId[];
}
