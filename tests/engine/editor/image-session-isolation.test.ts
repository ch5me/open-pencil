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

  const edited = markDocumentDirty(
    sessions[0]?.state ?? createImageSession(),
    "doc:one",
    false,
    "tx:save-one",
  );

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
  const beforeClose = dirty.state;

  expect(() => closeDocument(dirty.state, "doc:two", "tx:close-two")).toThrow(
    SessionCapabilityUnavailableError,
  );
  expect(dirty.state).toBe(beforeClose);
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

test("one multi-document session keeps dirty flags isolated when clean tab closes", () => {
  const opened = openDocuments(["one", "two", "three"]);
  const active = activateDocument(opened, "doc:one", "tx:activate-one");
  const dirtyOne = markDocumentDirty(active.state, "doc:one", true, "tx:edit-one");
  const closed = closeDocument(dirtyOne.state, "doc:two", "tx:close-two");

  expect(closed.state.activeDocumentId).toBe("doc:one");
  expect(closed.state.tabs).toEqual([
    { documentId: "doc:one", title: "one", dirty: true, recent: true },
    { documentId: "doc:three", title: "three", dirty: false, recent: true },
  ]);
  expect(() => closeDocument(closed.state, "doc:one", "tx:close-one")).toThrow(
    SessionCapabilityUnavailableError,
  );
});

test("dirty close of active document leaves every tab and selection unchanged", () => {
  const opened = openDocuments(["one", "two", "three"]);
  const active = activateDocument(opened, "doc:two", "tx:activate-two");
  const dirty = markDocumentDirty(active.state, "doc:two", true, "tx:edit-two");

  expect(() => closeDocument(dirty.state, "doc:two", "tx:close-two")).toThrow(
    SessionCapabilityUnavailableError,
  );
  expect(dirty.state.activeDocumentId).toBe("doc:two");
  expect(dirty.state.tabs.map((tab) => [tab.documentId, tab.dirty])).toEqual([
    ["doc:one", false],
    ["doc:two", true],
    ["doc:three", false],
  ]);
});
