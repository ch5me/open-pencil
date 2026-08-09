import type { TransactionId, ViewTransactionId } from "./types";

export interface JournalIdAllocator {
  transactionId(): TransactionId;
  viewTransactionId(): ViewTransactionId;
  journalSequence(): number;
}

export function createJournalIdAllocator(
  initialJournalSequence = 0,
  randomUUID: () => string = () => crypto.randomUUID(),
): JournalIdAllocator {
  let sequence = initialJournalSequence;
  return {
    transactionId: () => `tx:${randomUUID()}`,
    viewTransactionId: () => `view-tx:${randomUUID()}`,
    journalSequence: () => {
      sequence += 1;
      return sequence;
    },
  };
}
