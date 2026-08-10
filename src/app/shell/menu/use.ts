import { useEditorCommands, useI18n } from "@open-pencil/vue";
import type { EditorCommandId } from "@open-pencil/vue";
import { tryOnScopeDispose } from "@vueuse/core";

import { createAppMenuActions } from "@/app/shell/menu/actions";
import { importFileDialog, openFileDialog } from "@/app/shell/menu/files";
import { useAppTheme } from "@/app/shell/theme";
import { checkForAppUpdate } from "@/app/shell/updater";
import { isTauri } from "@/app/tauri/env";

const COMMAND_MENU_IDS = new Set<string>([
  "edit.undo",
  "edit.redo",
  "selection.selectAll",
  "selection.duplicate",
  "selection.delete",
  "selection.group",
  "selection.ungroup",
  "selection.createComponent",
  "selection.createComponentSet",
  "selection.detachInstance",
  "selection.wrapInAutoLayout",
  "selection.booleanUnion",
  "selection.booleanSubtract",
  "selection.booleanIntersect",
  "selection.booleanExclude",
  "selection.flatten",
  "selection.outlineText",
  "selection.outlineStroke",
  "selection.bringToFront",
  "selection.sendToBack",
  "view.zoom100",
  "view.zoomFit",
  "view.zoomSelection",
]);

export { importFileDialog, openFileDialog };
export { openFileFromPath } from "@/app/shell/menu/files";

export function useMenu() {
  if (!isTauri()) return;

  let unlisten: (() => void) | undefined;
  const { setTheme } = useAppTheme();
  const { dialogs } = useI18n();
  const { runCommand } = useEditorCommands();

  const actions: Partial<Record<string, () => void>> = {
    ...createAppMenuActions(setTheme),
    "check-updates": () => void checkForAppUpdate({ messages: dialogs }),
  };

  void import("@tauri-apps/api/event").then(({ listen }) => {
    void listen<string>("menu-event", (event) => {
      if (COMMAND_MENU_IDS.has(event.payload)) {
        runCommand(event.payload as EditorCommandId);
        return;
      }
      actions[event.payload]?.();
    }).then((fn) => {
      unlisten = fn;
    });
  });

  tryOnScopeDispose(() => unlisten?.());
}
