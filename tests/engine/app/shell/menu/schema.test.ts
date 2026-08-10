import { describe, expect, test } from "bun:test";

import { APP_MENU_ACTION_IDS } from "@/app/shell/menu/actions";
import type { AppMenuEntry } from "@/app/shell/menu/schema";
import { APP_MENU_SCHEMA } from "@/app/shell/menu/schema";

function actionItems(entries: readonly AppMenuEntry[]): AppMenuEntry[] {
  const result: AppMenuEntry[] = [];
  for (const entry of entries) {
    if ("type" in entry && entry.type === "separator") continue;
    result.push(entry);
    if (entry.sub) result.push(...actionItems(entry.sub));
  }
  return result;
}

describe("APP_MENU_SCHEMA", () => {
  test("maps every visible leaf action to a command or shell handler", () => {
    const specialIds = new Set([
      "dev-tools",
      "language",
      "profiler",
      "theme",
      "theme-light",
      "theme-dark",
      "theme-auto",
    ]);
    const missing = actionItems(APP_MENU_SCHEMA.flatMap((group) => group.items))
      .filter((entry): entry is Extract<AppMenuEntry, { type?: "item" }> => !("type" in entry))
      .filter(
        (entry) =>
          !entry.command &&
          !APP_MENU_ACTION_IDS.includes(entry.id as (typeof APP_MENU_ACTION_IDS)[number]) &&
          !specialIds.has(entry.id),
      )
      .map((entry) => entry.id);

    expect(missing).toEqual([]);
  });

  test("does not duplicate shortcuts for command-backed entries", () => {
    const duplicated = APP_MENU_SCHEMA.flatMap((group) =>
      actionItems(group.items).filter(
        (entry) => !("type" in entry) && entry.command && entry.shortcut,
      ),
    );

    expect(duplicated).toEqual([]);
  });
});
