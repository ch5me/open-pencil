export type SessionMenuAction =
  | "file.new"
  | "file.open"
  | "file.close"
  | "file.recent"
  | "edit.undo"
  | "edit.redo"
  | "layer.add"
  | "layer.delete"
  | "view.zoom"
  | "view.pan";

export type SessionTab = "layers" | "properties";

export interface DocumentTab {
  readonly documentId: string;
  readonly title: string;
  readonly dirty: boolean;
  readonly recent: boolean;
}

export interface ImageSessionState {
  readonly activeDocumentId: string | null;
  readonly tabs: readonly DocumentTab[];
  readonly activeTab: SessionTab;
  readonly panels: Readonly<Record<string, boolean>>;
  readonly shortcuts: Readonly<Record<string, string>>;
}

export interface SessionMutation {
  readonly documentId: string;
  readonly transactionId: `tx:${string}`;
  readonly state: ImageSessionState;
}

export class SessionCapabilityUnavailableError extends Error {
  readonly code = "E_SESSION_CAPABILITY_UNAVAILABLE";
}

export function createImageSession(state: Partial<ImageSessionState> = {}): ImageSessionState {
  return {
    activeDocumentId: state.activeDocumentId ?? null,
    tabs: [...(state.tabs ?? [])],
    activeTab: state.activeTab ?? "layers",
    panels: { ...state.panels },
    shortcuts: { ...state.shortcuts },
  };
}

export function openDocument(
  state: ImageSessionState,
  documentId: string,
  title = documentId,
  transactionId: `tx:${string}` = `tx:session-open`,
): SessionMutation {
  if (!documentId) throw new SessionCapabilityUnavailableError("document ID required");
  const tabs = state.tabs.some((tab) => tab.documentId === documentId)
    ? state.tabs
    : [...state.tabs, { documentId, title, dirty: false, recent: true }];
  return {
    documentId,
    transactionId,
    state: { ...state, activeDocumentId: documentId, tabs },
  };
}

export function markDocumentDirty(
  state: ImageSessionState,
  documentId: string,
  dirty: boolean,
  transactionId: `tx:${string}`,
): SessionMutation {
  const tabs = state.tabs.map((tab) => (tab.documentId === documentId ? { ...tab, dirty } : tab));
  return { documentId, transactionId, state: { ...state, tabs } };
}

export function closeDocument(
  state: ImageSessionState,
  documentId: string,
  transactionId: `tx:${string}`,
): SessionMutation {
  const tab = state.tabs.find((candidate) => candidate.documentId === documentId);
  if (tab?.dirty) throw new SessionCapabilityUnavailableError("dirty document needs confirmation");
  const tabs = state.tabs.filter((candidate) => candidate.documentId !== documentId);
  return {
    documentId,
    transactionId,
    state: {
      ...state,
      activeDocumentId:
        state.activeDocumentId === documentId
          ? (tabs[0]?.documentId ?? null)
          : state.activeDocumentId,
      tabs,
    },
  };
}
