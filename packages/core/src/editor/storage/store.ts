import type { ContentJournalEntry, ContentVersion } from "#core/editor/history/journal";

import type { ContentCommit, StagedChunk } from "./types";

export class ContentVersionConflict extends Error {
  readonly code = "content-version-conflict";
}

export class StagedChunkMismatch extends Error {
  readonly code = "staged-chunk-mismatch";
}

export class ImageEditorStore {
  private readonly chunks = new Map<string, StagedChunk>();
  private readonly journals = new Map<string, ContentJournalEntry>();
  private readonly heads = new Map<string, ContentVersion>();

  stageChunk(chunk: StagedChunk): void {
    if (chunk.chunkIndex < 0 || !Number.isSafeInteger(chunk.chunkIndex)) {
      throw new Error("chunkIndex must be a non-negative safe integer");
    }
    if (chunk.offset < 0 || !Number.isSafeInteger(chunk.offset)) {
      throw new Error("offset must be a non-negative safe integer");
    }
    if (chunk.byteLength !== chunk.bytes.byteLength)
      throw new StagedChunkMismatch("staged chunk length mismatch");
    if (!/^[0-9a-f]{64}$/u.test(chunk.sha256)) {
      throw new StagedChunkMismatch("staged chunk sha256 must be a lowercase SHA-256 hex digest");
    }
    this.chunks.set(`${chunk.transactionId}/${chunk.chunkIndex}`, {
      ...chunk,
      bytes: new Uint8Array(chunk.bytes),
    });
  }

  readStagedChunk(transactionId: string, chunkIndex: number): StagedChunk | undefined {
    const chunk = this.chunks.get(`${transactionId}/${chunkIndex}`);
    return chunk && { ...chunk, bytes: new Uint8Array(chunk.bytes) };
  }

  discardStaged(transactionId: string): void {
    for (const key of this.chunks.keys()) {
      if (key.startsWith(`${transactionId}/`)) this.chunks.delete(key);
    }
  }

  stagedChunkCount(transactionId: string): number {
    return [...this.chunks.values()].filter((chunk) => chunk.transactionId === transactionId)
      .length;
  }

  setInitialHead(documentId: string, head: ContentVersion): void {
    if (this.heads.has(documentId)) throw new Error(`content head already exists: ${documentId}`);
    this.heads.set(documentId, structuredClone(head));
  }

  getHead(documentId: string): ContentVersion | undefined {
    const head = this.heads.get(documentId);
    return head && structuredClone(head);
  }

  commitContent(commit: ContentCommit): void {
    const current = this.heads.get(commit.documentId);
    if (
      !current ||
      current.sequence !== commit.journal.baseContentVersion.sequence ||
      current.contentRootHash !== commit.journal.baseContentVersion.contentRootHash
    ) {
      throw new ContentVersionConflict("content head changed before commit");
    }
    for (const revisionId of commit.revisions) {
      if (!this.hasStagedRevision(commit.journal.transactionId, revisionId)) {
        throw new StagedChunkMismatch(`missing staged revision: ${revisionId}`);
      }
    }
    this.journals.set(
      `${commit.documentId}/${commit.journal.journalSequence}`,
      structuredClone(commit.journal),
    );
    this.heads.set(commit.documentId, structuredClone(commit.nextHead));
  }

  getJournal(documentId: string, sequence: number): ContentJournalEntry | undefined {
    const journal = this.journals.get(`${documentId}/${sequence}`);
    return journal && structuredClone(journal);
  }

  private hasStagedRevision(transactionId: string, revisionId: string): boolean {
    return [...this.chunks.values()].some(
      (chunk) =>
        chunk.transactionId === transactionId && chunk.sha256 === revisionId.replace("sha256:", ""),
    );
  }
}
