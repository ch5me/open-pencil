import { describe, expect, test } from "bun:test";

import {
  DEFAULT_EDITOR_WORKSPACE,
  normalizeEditorWorkspace,
} from "@/app/shell/layout-storage";

describe("editor workspace storage", () => {
  test("uses safe defaults for malformed workspace data", () => {
    expect(normalizeEditorWorkspace(null)).toEqual(DEFAULT_EDITOR_WORKSPACE);
    expect(normalizeEditorWorkspace({ layout: [0, Infinity, "50"] })).toEqual(
      DEFAULT_EDITOR_WORKSPACE,
    );
    expect(normalizeEditorWorkspace({ layout: [20, 20, 20] }).layout).toEqual(
      DEFAULT_EDITOR_WORKSPACE.layout,
    );
  });

  test("preserves supported panel preferences", () => {
    expect(
      normalizeEditorWorkspace({
        layout: [20, 60, 20],
        showUI: false,
        showRulers: false,
        showRemoteCursors: false,
        activeRibbonTab: "code",
        panelMode: "layers",
        leftPanelMode: "assets",
      }),
    ).toEqual({
      layout: [20, 60, 20],
      showUI: false,
      showRulers: false,
      showRemoteCursors: false,
      activeRibbonTab: "code",
      panelMode: "layers",
      leftPanelMode: "assets",
    });
  });

  test("normalizes unknown enum values instead of restoring invalid state", () => {
    expect(
      normalizeEditorWorkspace({
        activeRibbonTab: "unknown",
        panelMode: "unknown",
        leftPanelMode: "unknown",
      }),
    ).toMatchObject({
      activeRibbonTab: "panels",
      panelMode: "design",
      leftPanelMode: "layers",
    });
  });

  test("represents the global last-active shell workspace", () => {
    const workspace = normalizeEditorWorkspace({
      layout: [25, 50, 25],
      activeRibbonTab: "ai",
    });

    expect(workspace.activeRibbonTab).toBe("ai");
    expect("documentId" in workspace).toBe(false);
  });
});
