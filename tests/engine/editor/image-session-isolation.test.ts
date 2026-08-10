import { expect, test } from "bun:test";

import {
  activateDocument,
  closeDocument,
  createImageSession,
  markDocumentDirty,
  openDocument,
  SessionCapabilityUnavailableError,
} from "#core/editor/image-session";

function openDocuments(ids: readonly string[]) {
  return ids.reduce(
    (state, id) => openDocument(state, `doc:${id}`, id, `tx:open-${id}`).state,
    createImageSession(),
  );
}

test("three document sessions keep dirty state isolated across interleaved edits", () => {
  const sessions = ["one", "two", "three"].map((id) =>
    markDocumentDirty(
      openDocument(createImageSession(), `doc:${id}`, id, `tx:open-${id}`).state,
      `doc:${id}`,
      true,
      `tx:edit-${id}`,
    ),
  );

  const edited = markDocumentDirty(sessions[0]?.state ?? createImageSession(), "doc:one", false, "tx:save-one");

  expect(edited.state.tabs.find((tab) => tab.documentId === "doc:one")?.dirty).toBe(false);
  expect(sessions[1]?.state.tabs.find((tab) => tab.documentId === "doc:two")?.dirty).toBe(true);
  expect(sessions[2]?.state.tabs.find((tab) => tab.documentId === "doc:three")?.dirty).toBe(true);
  expect(sessions.map((session) => session.transactionId)).toEqual([
    "tx:edit-one",
    "tx:edit-two",
    "tx:edit-three",
  ]);
});

test("dirty close preserves inactive document and active selection", () => {
  const opened = openDocuments(["one", "two", "three"]);
  const active = activateDocument(opened, "doc:three", "tx:activate-three");
  const dirty = markDocumentDirty(active.state, "doc:two", true, "tx:edit-two");

  expect(() => closeDocument(dirty.state, "doc:two", "tx:close-two")).toThrow(
    SessionCapabilityUnavailableError,
  );
  expect(dirty.state.activeDocumentId).toBe("doc:three");
  expect(dirty.state.tabs.map((tab) => tab.documentId)).toEqual([
    "doc:one",
    "doc:two",
    "doc:three",
  ]);
  expect(dirty.state.tabs.find((tab) => tab.documentId === "doc:two")?.dirty).toBe(true);
});

test("clean close of inactive document leaves active document selected", () => {
  const opened = openDocuments(["one", "two", "three"]);
  const active = activateDocument(opened, "doc:three", "tx:activate-three");
  const closed = closeDocument(active.state, "doc:one", "tx:close-one");

  expect(closed.transactionId).toBe("tx:close-one");
  expect(closed.state.activeDocumentId).toBe("doc:three");
  expect(closed.state.tabs.map((tab) => tab.documentId)).toEqual(["doc:two", "doc:three"]);
});
