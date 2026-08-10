import { useEditorStore } from "@/app/editor/active-store";
import { pasteClipboardToReplace } from "@/app/editor/clipboard/paste-to-replace";
import { createSharedEditorMenuActions } from "@/app/shell/menu/editor-actions";
import { openFileDialog, openFileFromPath } from "@/app/shell/menu/files";
import { closeTab, createTab, activeTab, getRecentDocuments } from "@/app/tabs";

export const APP_MENU_ACTION_IDS = [
  "new",
  "open",
  "recent",
  "close",
  "save",
  "save-as",
  "export-selection",
  "export-png",
  "export-svg",
  "export-fig",
  "autosave",
  "copy",
  "cut",
  "paste",
  "paste-to-replace",
  "zoom-in",
  "zoom-out",
  "toggle-ui",
  "theme-light",
  "theme-dark",
  "theme-auto",
  "text.bold",
  "text.italic",
  "text.underline",
  "arrange.align-left",
  "arrange.align-center",
  "arrange.align-right",
  "arrange.align-top",
  "arrange.align-middle",
  "arrange.align-bottom",
] as const;

function execBrowserCommand(command: "copy" | "cut" | "paste"): void {
  document.execCommand(command);
}

export function createAppMenuActions(setTheme: (theme: "light" | "dark" | "auto") => void) {
  const store = useEditorStore();

  return {
    new: () => void createTab(),
    open: () => void openFileDialog(),
    recent: () => {
      const recent = getRecentDocuments()[0];
      if (recent) void openFileFromPath(recent.path);
    },
    close: () => {
      if (activeTab.value) closeTab(activeTab.value.id);
    },
    save: () => void store.saveFigFile(),
    "save-as": () => void store.saveFigFileAs(),
    "export-selection": () => {
      if (store.state.selectedIds.size > 0) void store.exportSelection(1, "png");
    },
    "export-png": () => {
      if (store.state.selectedIds.size > 0) void store.exportSelection(1, "png");
    },
    "export-svg": () => {
      if (store.state.selectedIds.size > 0) void store.exportSelection(1, "svg");
    },
    "export-fig": () => {
      if (store.state.selectedIds.size > 0) void store.exportSelection(1, "fig");
    },
    autosave: () => {
      store.state.autosaveEnabled = !store.state.autosaveEnabled;
    },
    copy: () => execBrowserCommand("copy"),
    cut: () => execBrowserCommand("cut"),
    paste: () => execBrowserCommand("paste"),
    "paste-to-replace": () => void pasteClipboardToReplace(store),
    ...createSharedEditorMenuActions(setTheme),
  };
}
