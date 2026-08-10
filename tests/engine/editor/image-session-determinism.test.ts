import { expect, test } from "bun:test";

import {
  activateDocument,
  closeDocument,
  createImageSession,
  markDocumentDirty,
  openDocument,
} from "#core/editor/image-session";

function buildSession() {
  const opened = openDocument(
    openDocument(createImageSession(), "doc:one", "One", "tx:open-one").state,
    "doc:two",
    "Two",
    "tx:open-two",
  );
  const active = activateDocument(opened.state, "doc:two", "tx:activate-two");
  return markDocumentDirty(active.state, "doc:one", true, "tx:edit-one");
}

test("dirty-close audit is deterministic and rejected close preserves session state", () => {
  const mutation = buildSession();
  const beforeClose = structuredClone(mutation.state);

  expect(() => closeDocument(mutation.state, "doc:one", "tx:close-one")).toThrow(
    "dirty document needs confirmation",
  );
  expect(mutation.state).toEqual(beforeClose);
  expect(mutation.state.activeDocumentId).toBe("doc:two");
  expect(mutation.state.tabs).toEqual([
    { documentId: "doc:one", title: "One", dirty: true, recent: true },
    { documentId: "doc:two", title: "Two", dirty: false, recent: true },
  ]);
});

test("replaying the same dirty-close session sequence yields identical state and transactions", () => {
  const first = buildSession();
  const second = buildSession();

  expect(first.transactionId).toBe("tx:edit-one");
  expect(second.transactionId).toBe(first.transactionId);
  expect(first.state).toEqual(second.state);
  expect(JSON.stringify(first.state)).toBe(JSON.stringify(second.state));
});
