import { IS_BROWSER } from "@open-pencil/core/constants";

const EDITOR_LAYOUT_KEY = "open-pencil:editor-layout";
const DEFAULT_EDITOR_LAYOUT = [18, 64, 18];
const EDITOR_WORKSPACE_KEY = "open-pencil:editor-workspace";

export type EditorWorkspaceState = {
  layout: number[];
  showUI: boolean;
  showRulers: boolean;
  showRemoteCursors: boolean;
  activeRibbonTab: "panels" | "code" | "ai";
  panelMode: "layers" | "design";
  leftPanelMode: "layers" | "assets";
};

export const DEFAULT_EDITOR_WORKSPACE: EditorWorkspaceState = {
  layout: DEFAULT_EDITOR_LAYOUT,
  showUI: true,
  showRulers: true,
  showRemoteCursors: true,
  activeRibbonTab: "panels",
  panelMode: "design",
  leftPanelMode: "layers",
};

function copyDefaultWorkspace(): EditorWorkspaceState {
  return { ...DEFAULT_EDITOR_WORKSPACE, layout: [...DEFAULT_EDITOR_LAYOUT] };
}

function isLayout(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item) && item > 0) &&
    Math.abs(value.reduce((sum, item) => sum + item, 0) - 100) < 0.01
  );
}

export function normalizeEditorWorkspace(value: unknown): EditorWorkspaceState {
  const fallback = copyDefaultWorkspace();
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Partial<EditorWorkspaceState>;
  return {
    layout: isLayout(candidate.layout) ? [...candidate.layout] : fallback.layout,
    showUI: typeof candidate.showUI === "boolean" ? candidate.showUI : fallback.showUI,
    showRulers:
      typeof candidate.showRulers === "boolean" ? candidate.showRulers : fallback.showRulers,
    showRemoteCursors:
      typeof candidate.showRemoteCursors === "boolean"
        ? candidate.showRemoteCursors
        : fallback.showRemoteCursors,
    activeRibbonTab:
      candidate.activeRibbonTab === "code" || candidate.activeRibbonTab === "ai"
        ? candidate.activeRibbonTab
        : "panels",
    panelMode: candidate.panelMode === "layers" ? "layers" : "design",
    leftPanelMode: candidate.leftPanelMode === "assets" ? "assets" : "layers",
  };
}

export function loadEditorLayout(): number[] {
  if (!IS_BROWSER) return DEFAULT_EDITOR_LAYOUT;
  try {
    const raw = window.localStorage.getItem(EDITOR_LAYOUT_KEY);
    if (!raw) return DEFAULT_EDITOR_LAYOUT;
    const parsed = JSON.parse(raw);
    return isLayout(parsed) ? parsed : DEFAULT_EDITOR_LAYOUT;
  } catch {
    return DEFAULT_EDITOR_LAYOUT;
  }
}

export function saveEditorLayout(layout: number[]): void {
  if (!IS_BROWSER) return;
  if (isLayout(layout)) window.localStorage.setItem(EDITOR_LAYOUT_KEY, JSON.stringify(layout));
}

export function loadEditorWorkspace(): EditorWorkspaceState {
  if (!IS_BROWSER) return copyDefaultWorkspace();
  try {
    const raw = window.localStorage.getItem(EDITOR_WORKSPACE_KEY);
    if (raw) return normalizeEditorWorkspace(JSON.parse(raw));

    // Migrate the original splitter-only preference into the workspace state.
    return normalizeEditorWorkspace({ layout: loadEditorLayout() });
  } catch {
    return copyDefaultWorkspace();
  }
}

export function saveEditorWorkspace(workspace: EditorWorkspaceState): void {
  if (!IS_BROWSER) return;
  const normalized = normalizeEditorWorkspace(workspace);
  try {
    window.localStorage.setItem(EDITOR_WORKSPACE_KEY, JSON.stringify(normalized));
  } catch {
    return;
  }

  // Keep the legacy key in sync when storage allows it. The workspace key is
  // canonical, so a quota failure here must not break shell state updates.
  try {
    saveEditorLayout(normalized.layout);
  } catch (error) {
    // Storage adapters can throw independently per key.
    console.warn("[Editor Workspace] legacy layout save skipped", error);
  }
}
