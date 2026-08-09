import type {
  ContentJournalEntry,
  ContentJournalStatus,
  ViewJournalEntry,
  ViewJournalStatus,
} from "./types";

const CONTENT_TRANSITIONS: Readonly<Record<ContentJournalStatus, readonly ContentJournalStatus[]>> =
  {
    validating: ["staging", "rolling-back"],
    staging: ["prepared", "rolling-back"],
    prepared: ["committing", "rolling-back"],
    committing: ["committed", "rolling-back"],
    committed: ["publishing"],
    publishing: ["published"],
    published: [],
    "rolling-back": ["rolled-back"],
    "rolled-back": [],
  };

const VIEW_TRANSITIONS: Readonly<Record<ViewJournalStatus, readonly ViewJournalStatus[]>> = {
  prepared: ["committed", "rolled-back"],
  committed: ["published"],
  published: [],
  "rolled-back": [],
};

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertVersion(
  value: { sequence: number; contentRootHash?: string; viewRootHash?: string },
  label: string,
): void {
  assertFiniteNonNegative(value.sequence, `${label}.sequence`);
  const root = value.contentRootHash ?? value.viewRootHash;
  if (!root || !/^[0-9a-f]{64}$/u.test(root)) {
    throw new Error(`${label} root hash must be a lowercase SHA-256 hex digest`);
  }
}

export function validateContentJournal(entry: ContentJournalEntry): void {
  assertFiniteNonNegative(entry.journalSequence, "journalSequence");
  assertVersion(entry.baseContentVersion, "baseContentVersion");
  assertVersion(entry.nextContentVersion, "nextContentVersion");
  if (entry.nextContentVersion.sequence <= entry.baseContentVersion.sequence) {
    throw new Error("nextContentVersion must advance baseContentVersion");
  }
  if ("baseViewVersion" in (entry as unknown as Record<string, unknown>)) {
    throw new Error("content journal must not contain baseViewVersion");
  }
  if (
    entry.persistedHistoryByteDelta < 0 ||
    !Number.isSafeInteger(entry.persistedHistoryByteDelta)
  ) {
    throw new Error("persistedHistoryByteDelta must be a non-negative safe integer");
  }
  if (!Number.isFinite(entry.createdAt) || !Number.isFinite(entry.updatedAt)) {
    throw new Error("journal timestamps must be finite");
  }
  if (entry.updatedAt < entry.createdAt) {
    throw new Error("updatedAt must not precede createdAt");
  }
}

export function validateViewJournal(entry: ViewJournalEntry): void {
  assertVersion(entry.baseViewVersion, "baseViewVersion");
  assertVersion(entry.nextViewVersion, "nextViewVersion");
  if (entry.nextViewVersion.sequence <= entry.baseViewVersion.sequence) {
    throw new Error("nextViewVersion must advance baseViewVersion");
  }
  if (!Number.isFinite(entry.createdAt) || !Number.isFinite(entry.updatedAt)) {
    throw new Error("journal timestamps must be finite");
  }
  if (entry.updatedAt < entry.createdAt) {
    throw new Error("updatedAt must not precede createdAt");
  }
}

export function canTransitionContentJournal(
  from: ContentJournalStatus,
  to: ContentJournalStatus,
): boolean {
  return CONTENT_TRANSITIONS[from].includes(to);
}

export function canTransitionViewJournal(from: ViewJournalStatus, to: ViewJournalStatus): boolean {
  return VIEW_TRANSITIONS[from].includes(to);
}

export function transitionContentJournal(
  entry: ContentJournalEntry,
  status: ContentJournalStatus,
  updatedAt = Date.now(),
): ContentJournalEntry {
  validateContentJournal(entry);
  if (!canTransitionContentJournal(entry.status, status)) {
    throw new Error(`invalid content journal transition: ${entry.status} -> ${status}`);
  }
  return { ...entry, status, updatedAt };
}

export function transitionViewJournal(
  entry: ViewJournalEntry,
  status: ViewJournalStatus,
  updatedAt = Date.now(),
): ViewJournalEntry {
  validateViewJournal(entry);
  if (!canTransitionViewJournal(entry.status, status)) {
    throw new Error(`invalid view journal transition: ${entry.status} -> ${status}`);
  }
  return { ...entry, status, updatedAt };
}
