import type {
  ContentJournalEntry,
  ContentJournalStatus,
  ContentRevisionId,
  HistoryPin,
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

function assertRevisionId(value: string, label: string): asserts value is ContentRevisionId {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 revision ID`);
  }
}

function assertRevisionRef(
  revision: ContentJournalEntry["stagedContentRevisions"][number],
  index: number,
): void {
  assertRevisionId(revision.revisionId, `stagedContentRevisions[${index}].revisionId`);
  if (!revision.kind.trim()) {
    throw new Error(`stagedContentRevisions[${index}].kind must not be empty`);
  }
  if (!Number.isSafeInteger(revision.byteLength) || revision.byteLength < 0) {
    throw new Error(`stagedContentRevisions[${index}].byteLength must be non-negative`);
  }
  if (!/^[0-9a-f]{64}$/u.test(revision.sha256)) {
    throw new Error(`stagedContentRevisions[${index}].sha256 must be a lowercase SHA-256 digest`);
  }
  if (typeof revision.temporary !== "boolean") {
    throw new Error(`stagedContentRevisions[${index}].temporary must be boolean`);
  }
  if (revision.metadata === null || typeof revision.metadata !== "object") {
    throw new Error(`stagedContentRevisions[${index}].metadata must be an object`);
  }
}

function assertHistoryPin(pin: HistoryPin, index: number): void {
  if (!pin.pinId.trim()) throw new Error(`historyPinsAdded[${index}].pinId must not be empty`);
  if (!pin.kind.trim()) throw new Error(`historyPinsAdded[${index}].kind must not be empty`);
  const revisions = new Set<ContentRevisionId>();
  for (const [revisionIndex, revisionId] of pin.revisionIds.entries()) {
    assertRevisionId(revisionId, `historyPinsAdded[${index}].revisionIds[${revisionIndex}]`);
    if (revisions.has(revisionId)) {
      throw new Error(`historyPinsAdded[${index}] contains duplicate revision IDs`);
    }
    revisions.add(revisionId);
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
  const stagedRevisionIds = new Set<ContentRevisionId>();
  entry.stagedContentRevisions.forEach((revision, index) => {
    assertRevisionRef(revision, index);
    if (stagedRevisionIds.has(revision.revisionId)) {
      throw new Error(`stagedContentRevisions contains duplicate revision ID: ${revision.revisionId}`);
    }
    stagedRevisionIds.add(revision.revisionId);
  });
  const releasedRevisionIds = new Set<ContentRevisionId>();
  entry.releasedContentRevisions.forEach((revisionId, index) => {
    assertRevisionId(revisionId, `releasedContentRevisions[${index}]`);
    if (releasedRevisionIds.has(revisionId)) {
      throw new Error(`releasedContentRevisions contains duplicate revision ID: ${revisionId}`);
    }
    releasedRevisionIds.add(revisionId);
  });
  const pinIds = new Set<string>();
  entry.historyPinsAdded.forEach((pin, index) => {
    assertHistoryPin(pin, index);
    if (pinIds.has(pin.pinId)) {
      throw new Error(`historyPinsAdded contains duplicate pin ID: ${pin.pinId}`);
    }
    pinIds.add(pin.pinId);
  });
  const releasedPinIds = new Set<string>();
  entry.historyPinsReleased.forEach((pinId, index) => {
    if (!pinId.trim()) throw new Error(`historyPinsReleased[${index}] must not be empty`);
    if (releasedPinIds.has(pinId)) {
      throw new Error(`historyPinsReleased contains duplicate pin ID: ${pinId}`);
    }
    releasedPinIds.add(pinId);
  });
  for (const pinId of pinIds) {
    if (releasedPinIds.has(pinId)) {
      throw new Error(`history pin cannot be added and released in one journal: ${pinId}`);
    }
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
  if (!Number.isFinite(updatedAt) || updatedAt < entry.createdAt) {
    throw new Error("updatedAt must be finite and not precede createdAt");
  }
  return { ...structuredClone(entry), status, updatedAt };
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
  if (!Number.isFinite(updatedAt) || updatedAt < entry.createdAt) {
    throw new Error("updatedAt must be finite and not precede createdAt");
  }
  return { ...structuredClone(entry), status, updatedAt };
}
