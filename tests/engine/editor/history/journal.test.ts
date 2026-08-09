import { describe, expect, test } from "bun:test";

import {
  createContentJournal,
  createContentRevisionId,
  createContentSnapshot,
  createJournalIdAllocator,
  createViewJournal,
  transitionContentJournal,
  transitionViewJournal,
  validateContentJournal,
  applyContentSnapshotTransition,
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

  test("view-only commits leave content history unchanged", () => {
    const allocator = createJournalIdAllocator(0, () => "journal-id");
    const content = createContentJournal(allocator, {
      journalSequence: allocator.journalSequence(),
      baseContentVersion: { sequence: 1, contentRootHash: ROOT },
      nextContentVersion: { sequence: 2, contentRootHash: "b".repeat(64) },
      contractHash: "contract",
      authorityMatrixHash: "c".repeat(64),
    });
    const view = createViewJournal(allocator, {
      baseViewVersion: { sequence: 4, viewRootHash: ROOT },
      nextViewVersion: { sequence: 5, viewRootHash: "d".repeat(64) },
    });

    const publishedView = transitionViewJournal(
      transitionViewJournal(view, "committed"),
      "published",
    );

    expect(publishedView.status).toBe("published");
    expect(content).toMatchObject({
      status: "validating",
      baseContentVersion: { sequence: 1, contentRootHash: ROOT },
      nextContentVersion: { sequence: 2, contentRootHash: "b".repeat(64) },
    });
    expect(content).not.toHaveProperty("baseViewVersion");
    expect(content).not.toHaveProperty("nextViewVersion");
  });

  test("revision identity changes when metadata or bytes change", async () => {
    const first = await createContentRevisionId("png", { width: 2 }, new Uint8Array([1]));
    const metadataChange = await createContentRevisionId("png", { width: 3 }, new Uint8Array([1]));
    const bytesChange = await createContentRevisionId("png", { width: 2 }, new Uint8Array([2]));
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(metadataChange).not.toBe(first);
    expect(bytesChange).not.toBe(first);
  });

  test("restores content and masks through deterministic undo/redo snapshots", () => {
    const base = createContentSnapshot("a".repeat(64), [
      { maskId: "mask-b", byteHash: `sha256:${"b".repeat(64)}` },
      { maskId: "mask-a", byteHash: `sha256:${"a".repeat(64)}` },
    ]);
    const next = createContentSnapshot("c".repeat(64), [
      { maskId: "mask-a", byteHash: `sha256:${"d".repeat(64)}` },
      { maskId: "mask-b", byteHash: `sha256:${"e".repeat(64)}` },
    ]);
    const transition = { base, next };
    expect(applyContentSnapshotTransition(next, transition, "undo")).toEqual(base);
    expect(applyContentSnapshotTransition(base, transition, "redo")).toEqual(next);
    expect(() => applyContentSnapshotTransition(base, transition, "undo")).toThrow(
      "undo snapshot base mismatch",
    );
  });

  test("canonicalizes hash prefixes before comparing snapshot ownership", () => {
    const base = createContentSnapshot(`sha256:${"a".repeat(64)}`, [
      { maskId: "mask-a", byteHash: "b".repeat(64) as `sha256:${string}` },
    ]);
    const next = createContentSnapshot("c".repeat(64), [
      { maskId: "mask-a", byteHash: `sha256:${"d".repeat(64)}` },
    ]);

    expect(base).toEqual({
      contentRootHash: "a".repeat(64),
      maskHashes: [{ maskId: "mask-a", byteHash: `sha256:${"b".repeat(64)}` }],
    });
    expect(
      applyContentSnapshotTransition(
        createContentSnapshot(`sha256:${"a".repeat(64)}`, [
          { maskId: "mask-a", byteHash: `sha256:${"b".repeat(64)}` },
        ]),
        { base, next },
        "redo",
      ),
    ).toEqual(next);
  });

  test("rejects duplicate mask ownership in one snapshot", () => {
    expect(() =>
      createContentSnapshot("a".repeat(64), [
        { maskId: "mask-a", byteHash: `sha256:${"b".repeat(64)}` },
        { maskId: "mask-a", byteHash: `sha256:${"c".repeat(64)}` },
      ]),
    ).toThrow("duplicate maskId: mask-a");
  });

  test("10,000 deterministic snapshot replays preserve exact base and next hashes", () => {
    let state = createContentSnapshot("0".repeat(64));
    const snapshots = [state];
    for (let index = 1; index <= 10_000; index += 1) {
      const next = createContentSnapshot(index.toString(16).padStart(64, "0"), [
        {
          maskId: `mask-${index % 7}`,
          byteHash: `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
        },
      ]);
      state = applyContentSnapshotTransition(state, { base: state, next }, "redo");
      snapshots.push(state);
    }
    for (let index = snapshots.length - 1; index > 0; index -= 1) {
      state = applyContentSnapshotTransition(
        state,
        {
          base: snapshots[index - 1] as typeof state,
          next: snapshots[index] as typeof state,
        },
        "undo",
      );
    }
    expect(state).toEqual(snapshots[0]);
  });

  test("rejects duplicate staged revisions and history pins", () => {
    const allocator = createJournalIdAllocator(0, () => "journal-id");
    const revision = {
      revisionId: `sha256:${"d".repeat(64)}` as const,
      kind: "mask",
      metadata: {},
      byteLength: 1,
      sha256: "d".repeat(64),
      temporary: true,
    };
    expect(() =>
      createContentJournal(allocator, {
        journalSequence: 1,
        baseContentVersion: { sequence: 1, contentRootHash: ROOT },
        nextContentVersion: { sequence: 2, contentRootHash: "b".repeat(64) },
        contractHash: "contract",
        authorityMatrixHash: "c".repeat(64),
        stagedContentRevisions: [revision, revision],
      }),
    ).toThrow("duplicate revision ID");

    expect(() =>
      createContentJournal(allocator, {
        journalSequence: 2,
        baseContentVersion: { sequence: 2, contentRootHash: "b".repeat(64) },
        nextContentVersion: { sequence: 3, contentRootHash: "e".repeat(64) },
        contractHash: "contract",
        authorityMatrixHash: "c".repeat(64),
        historyPinsAdded: [
          {
            pinId: "pin",
            kind: "archive",
            revisionIds: [revision.revisionId, revision.revisionId],
          },
        ],
      }),
    ).toThrow("duplicate revision IDs");
  });

  test("transitions clone journal payloads and reject invalid timestamps", () => {
    const allocator = createJournalIdAllocator(0, () => "journal-id");
    const journal = createContentJournal(allocator, {
      journalSequence: 1,
      baseContentVersion: { sequence: 1, contentRootHash: ROOT },
      nextContentVersion: { sequence: 2, contentRootHash: "b".repeat(64) },
      contractHash: "contract",
      authorityMatrixHash: "c".repeat(64),
      forwardOps: [{ nested: { value: 1 } }],
      now: 10,
    });
    expect(() => transitionContentJournal(journal, "staging", 9)).toThrow(
      "not precede createdAt",
    );
    const transitioned = transitionContentJournal(journal, "staging", 11);
    (transitioned.forwardOps[0] as { nested: { value: number } }).nested.value = 2;
    expect((journal.forwardOps[0] as { nested: { value: number } }).nested.value).toBe(1);
  });
});
