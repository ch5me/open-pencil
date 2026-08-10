import { describe, expect, test } from "bun:test";

import type { EditorCommandId } from "@open-pencil/vue";
import { computed } from "vue";

import { buildCanvasContextMenu } from "#vue/editor/menu-model/canvas";
import type { CanvasMenuOptions } from "#vue/editor/menu-model/canvas";
import type { useSelectionState } from "#vue/editor/selection-state/use";

type SelectionState = ReturnType<typeof useSelectionState>;

function selection(overrides: Partial<SelectionState> = {}) {
  return {
    hasSelection: computed(() => true),
    isGroup: computed(() => false),
    isComponent: computed(() => false),
    isInstance: computed(() => false),
    canCreateComponentSet: computed(() => false),
    ...overrides,
  } as CanvasMenuOptions["selection"];
}

function options(overrides: Partial<CanvasMenuOptions> = {}): CanvasMenuOptions {
  return {
    commandMenuItem(id: EditorCommandId) {
      return { id, label: id };
    },
    otherPages: [] as CanvasMenuOptions["otherPages"],
    moveSelectionToPage: () => undefined,
    selection: selection(),
    t: { moveToPage: "Move to page" },
    ...overrides,
  } as CanvasMenuOptions;
}

function labels(menu: ReturnType<typeof buildCanvasContextMenu>) {
  return menu.flatMap((entry) => {
    if (entry.separator) return [];
    if (entry.sub) {
      return [
        entry.label,
        ...entry.sub.flatMap((item) => (item.separator ? [] : [item.label])),
      ];
    }
    return [entry.label];
  });
}

describe("buildCanvasContextMenu selection variants", () => {
  test("omits move-to-page when canvas has no selection", () => {
    const menu = buildCanvasContextMenu(
      options({ selection: selection({ hasSelection: computed(() => false) }) }),
    );

    expect(labels(menu)).not.toContain("Move to page");
    expect(labels(menu)).toContain("selection.delete");
  });

  test("switches component action for component selections", () => {
    const menu = buildCanvasContextMenu(
      options({ selection: selection({ isComponent: computed(() => true) }) }),
    );

    expect(labels(menu)).toContain("selection.createInstance");
    expect(labels(menu)).not.toContain("selection.createComponent");
  });

  test("adds component-set and instance actions only when capabilities allow", () => {
    const menu = buildCanvasContextMenu(
      options({
        selection: selection({
          canCreateComponentSet: computed(() => true),
          isInstance: computed(() => true),
        }),
      }),
    );

    expect(labels(menu)).toEqual(
      expect.arrayContaining([
        "selection.createComponentSet",
        "selection.goToMainComponent",
        "selection.detachInstance",
      ]),
    );
  });

  test("adds move-to-page submenu only for available pages", () => {
    const moveCalls: string[] = [];
    const menu = buildCanvasContextMenu(
      options({
        otherPages: [{ id: "page-2", name: "Page 2" }] as CanvasMenuOptions["otherPages"],
        moveSelectionToPage: (pageId) => moveCalls.push(pageId),
      }),
    );
    const move = menu.find((entry) => !entry.separator && entry.label === "Move to page");

    expect(
      move && !move.separator
        ? move.sub?.flatMap((item) => (item.separator ? [] : [item.label]))
        : [],
    ).toEqual(["Page 2"]);
    const firstPage = move && !move.separator ? move.sub?.[0] : undefined;
    if (firstPage && !firstPage.separator) firstPage.action?.();
    expect(moveCalls).toEqual(["page-2"]);
  });
});
