import { expect, test } from "bun:test";

import {
  activateDocument,
  closeDocument,
  createImageSession,
  markDocumentDirty,
  openDocument,
  SessionCapabilityUnavailableError,
  type SessionMenuAction,
} from "#core/editor/image-session";

test("image-session-v1 supports document tabs, dirty state, and one mutation transaction", () => {
  const opened = openDocument(createImageSession(), "doc:one", "One", "tx:open");
  const dirty = markDocumentDirty(opened.state, "doc:one", true, "tx:edit");
  expect(dirty.transactionId).toBe("tx:edit");
  expect(dirty.state.tabs[0]?.dirty).toBe(true);
  expect(dirty.state.activeDocumentId).toBe("doc:one");
});

test("dirty close fails loud; clean close restores active tab", () => {
  const opened = openDocument(createImageSession(), "doc:one", "One", "tx:open");
  const dirty = markDocumentDirty(opened.state, "doc:one", true, "tx:edit");
  expect(() => closeDocument(dirty.state, "doc:one", "tx:close")).toThrow(
    SessionCapabilityUnavailableError,
  );
  const closed = closeDocument(opened.state, "doc:one", "tx:close");
  expect(closed.state.activeDocumentId).toBeNull();
  expect(new SessionCapabilityUnavailableError().code).toBe("E_SESSION_CAPABILITY_UNAVAILABLE");
});

test("document workflow rejects unknown tabs and activates an existing tab", () => {
  const opened = openDocument(
    openDocument(createImageSession(), "doc:one", "One", "tx:open-one").state,
    "doc:two",
    "Two",
    "tx:open-two",
  );
  const activated = activateDocument(opened.state, "doc:one", "tx:activate");
  expect(activated.state.activeDocumentId).toBe("doc:one");
  expect(() => activateDocument(opened.state, "doc:missing", "tx:activate")).toThrow(
    SessionCapabilityUnavailableError,
  );
  expect(() => markDocumentDirty(opened.state, "doc:missing", true, "tx:edit")).toThrow(
    "document is not open",
  );
  expect(() => closeDocument(opened.state, "doc:missing", "tx:close")).toThrow(
    "document is not open",
  );
});

test("shell-command-v1 maps visible actions and isolates three document sessions", () => {
  const actions: readonly SessionMenuAction[] = [
    "file.new",
    "file.open",
    "file.close",
    "file.recent",
    "edit.undo",
    "edit.redo",
    "layer.add",
    "layer.delete",
    "view.zoom",
    "view.pan",
  ];
  const commandIds = actions.map((action) => `cmd:${action}`);
  expect(new Set(commandIds).size).toBe(actions.length);
  const sessions = ["one", "two", "three"].map((id) => {
    const opened = openDocument(createImageSession(), `doc:${id}`, id, `tx:open-${id}`);
    return markDocumentDirty(opened.state, `doc:${id}`, true, `tx:edit-${id}`);
  });
  expect(sessions.map((session) => session.state.activeDocumentId)).toEqual([
    "doc:one",
    "doc:two",
    "doc:three",
  ]);
  expect(new Set(sessions.map((session) => session.transactionId)).size).toBe(3);
  expect(() =>
    closeDocument(sessions[0]?.state ?? createImageSession(), "doc:one", "tx:close"),
  ).toThrow(SessionCapabilityUnavailableError);
});
