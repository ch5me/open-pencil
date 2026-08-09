import { expect, test } from "bun:test";

import {
  closeDocument,
  createImageSession,
  markDocumentDirty,
  openDocument,
  SessionCapabilityUnavailableError,
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
