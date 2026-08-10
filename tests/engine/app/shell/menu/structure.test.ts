import { describe, expect, test } from "bun:test";

import type { AppMenuEntry, AppMenuGroupSchema } from "@/app/shell/menu/schema";
import { APP_MENU_SCHEMA } from "@/app/shell/menu/schema";

const schema: readonly AppMenuGroupSchema[] = APP_MENU_SCHEMA;

function actionItems(entries: readonly AppMenuEntry[]): Extract<AppMenuEntry, { type?: "item" }>[] {
  return entries.flatMap((entry) => {
    if ("type" in entry && entry.type === "separator") return [];
    return [entry, ...(entry.sub ? actionItems(entry.sub) : [])];
  });
}

describe("APP_MENU_SCHEMA structure", () => {
  test("keeps top-level menu order stable", () => {
    expect(schema.map((group) => group.label)).toEqual([
      "File",
      "Edit",
      "View",
      "Object",
      "Text",
      "Arrange",
    ]);
  });

  test("uses unique action ids across nested submenus", () => {
    const ids = actionItems(schema.flatMap((group) => group.items)).map(
      (entry) => entry.id,
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("keeps native-only entries out of browser menu groups", () => {
    const nativeOnly = schema.flatMap((group) => group.items).flatMap((entry) => {
      if ("type" in entry && entry.type === "separator") return [];
      return entry.id === "dev-tools" ? [entry] : [];
    });

    expect(nativeOnly).toHaveLength(1);
    expect(nativeOnly[0]?.target).toBe("native");
    expect(schema.flatMap((group) => group.items).some((entry) => {
      return !("type" in entry) && entry.id === "dev-tools" && entry.target !== "native";
    })).toBe(false);
  });
});
