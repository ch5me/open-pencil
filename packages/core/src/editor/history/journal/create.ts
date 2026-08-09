import type { JournalIdAllocator } from "./ids";
import type {
  ContentJournalEntry,
  ContentSnapshot,
  ContentRevisionRef,
  ContentVersion,
  HistoryPin,
  ViewJournalEntry,
  ViewVersion,
} from "./types";
import { createContentSnapshot } from "./snapshot";
import { validateContentJournal, validateViewJournal } from "./validate";

export interface ContentJournalInput {
  readonly journalSequence: number;
  readonly baseContentVersion: ContentVersion;
  readonly nextContentVersion: ContentVersion;
  readonly baseContentSnapshot?: ContentSnapshot;
  readonly nextContentSnapshot?: ContentSnapshot;
  readonly contractHash: string;
  readonly authorityMatrixHash: string;
  readonly capabilityVersions?: readonly string[];
  readonly forwardOps?: readonly unknown[];
  readonly inverseOps?: readonly unknown[];
  readonly stagedContentRevisions?: readonly ContentRevisionRef[];
  readonly releasedContentRevisions?: readonly `sha256:${string}`[];
  readonly historyPinsAdded?: readonly HistoryPin[];
  readonly historyPinsReleased?: readonly string[];
  readonly persistedHistoryByteDelta?: number;
  readonly now?: number;
}

export function createContentJournal(
  allocator: JournalIdAllocator,
  input: ContentJournalInput,
): ContentJournalEntry {
  const now = input.now ?? Date.now();
  const entry: ContentJournalEntry = {
    transactionId: allocator.transactionId(),
    journalSequence: input.journalSequence,
    baseContentVersion: structuredClone(input.baseContentVersion),
    nextContentVersion: structuredClone(input.nextContentVersion),
    baseContentSnapshot: structuredClone(
      input.baseContentSnapshot ??
        createContentSnapshot(input.baseContentVersion.contentRootHash),
    ),
    nextContentSnapshot: structuredClone(
      input.nextContentSnapshot ??
        createContentSnapshot(input.nextContentVersion.contentRootHash),
    ),
    contractHash: input.contractHash,
    authorityMatrixHash: input.authorityMatrixHash,
    capabilityVersions: [...(input.capabilityVersions ?? [])],
    forwardOps: structuredClone(input.forwardOps ?? []),
    inverseOps: structuredClone(input.inverseOps ?? []),
    stagedContentRevisions: structuredClone(input.stagedContentRevisions ?? []),
    releasedContentRevisions: [...(input.releasedContentRevisions ?? [])],
    historyPinsAdded: structuredClone(input.historyPinsAdded ?? []),
    historyPinsReleased: [...(input.historyPinsReleased ?? [])],
    persistedHistoryByteDelta: input.persistedHistoryByteDelta ?? 0,
    status: "validating",
    createdAt: now,
    updatedAt: now,
  };
  validateContentJournal(entry);
  return entry;
}

export interface ViewJournalInput {
  readonly baseViewVersion: ViewVersion;
  readonly nextViewVersion: ViewVersion;
  readonly viewOps?: readonly unknown[];
  readonly now?: number;
}

export function createViewJournal(
  allocator: JournalIdAllocator,
  input: ViewJournalInput,
): ViewJournalEntry {
  const now = input.now ?? Date.now();
  const entry: ViewJournalEntry = {
    viewTransactionId: allocator.viewTransactionId(),
    baseViewVersion: structuredClone(input.baseViewVersion),
    nextViewVersion: structuredClone(input.nextViewVersion),
    viewOps: structuredClone(input.viewOps ?? []),
    status: "prepared",
    createdAt: now,
    updatedAt: now,
  };
  validateViewJournal(entry);
  return entry;
}
