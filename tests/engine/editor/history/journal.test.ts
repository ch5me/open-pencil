import { describe, expect, test } from "bun:test";

import {
  createContentJournal,
  createContentRevisionId,
  createJournalIdAllocator,
  createViewJournal,
  transitionContentJournal,
  transitionViewJournal,
  validateContentJournal,
} from "#core/editor/history/journal";

const ROOT = "a".repeat(64);

describe("editor history journal", () => {
  test("creates host-owned content IDs and follows the content lifecycle", () => {
    const allocator = createJournalIdAllocator(7, () => "content-id");
    let journal = createContentJournal(allocator, {
      journalSequence: allocator.journalSequence(),
      baseContentVersion: { sequence: 1, contentRootHash: ROOT },
      nextContentVersion: { sequence: 2, contentRootHash: "b".repeat(64) },
      contractHash: "contract",
      authorityMatrixHash: "c".repeat(64),
      now: 10,
    });

    expect(journal.transactionId).toBe("tx:content-id");
    expect(journal.journalSequence).toBe(8);
    for (const status of [
      "staging",
      "prepared",
      "committing",
      "committed",
      "publishing",
      "published",
    ] as const) {
      journal = transitionContentJournal(journal, status, journal.updatedAt + 1);
    }
    expect(journal.status).toBe("published");
  });

  test("rejects a content journal that carries view CAS state", () => {
    const allocator = createJournalIdAllocator(0, () => "content-id");
    const journal = createContentJournal(allocator, {
      journalSequence: 1,
      baseContentVersion: { sequence: 1, contentRootHash: ROOT },
      nextContentVersion: { sequence: 2, contentRootHash: "b".repeat(64) },
      contractHash: "contract",
      authorityMatrixHash: "c".repeat(64),
    });
    const invalid = { ...journal, baseViewVersion: { sequence: 1, viewRootHash: ROOT } };
    expect(() => validateContentJournal(invalid)).toThrow("baseViewVersion");
  });

  test("view journals commit independently", () => {
    const allocator = createJournalIdAllocator(0, () => "view-id");
    let journal = createViewJournal(allocator, {
      baseViewVersion: { sequence: 4, viewRootHash: ROOT },
      nextViewVersion: { sequence: 5, viewRootHash: "b".repeat(64) },
    });
    journal = transitionViewJournal(journal, "committed");
    journal = transitionViewJournal(journal, "published");
    expect(journal.status).toBe("published");
  });

  test("revision identity changes when metadata or bytes change", async () => {
    const first = await createContentRevisionId("png", { width: 2 }, new Uint8Array([1]));
    const metadataChange = await createContentRevisionId("png", { width: 3 }, new Uint8Array([1]));
    const bytesChange = await createContentRevisionId("png", { width: 2 }, new Uint8Array([2]));
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(metadataChange).not.toBe(first);
    expect(bytesChange).not.toBe(first);
  });
});
