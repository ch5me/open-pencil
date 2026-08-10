import { afterEach, describe, expect, test } from "bun:test";

import {
  clearRecentDocuments,
  getRecentDocuments,
  recordRecentDocument,
} from "@/app/tabs";

describe("recent documents", () => {
  afterEach(() => clearRecentDocuments());

  test("keeps newest paths first and removes duplicates", () => {
    recordRecentDocument("First", "/tmp/first.fig");
    recordRecentDocument("Second", "/tmp/second.fig");
    recordRecentDocument("First renamed", "/tmp/first.fig");

    expect(getRecentDocuments()).toEqual([
      { name: "First renamed", path: "/tmp/first.fig" },
      { name: "Second", path: "/tmp/second.fig" },
    ]);
  });

  test("caps recent documents at ten entries", () => {
    for (let index = 0; index < 12; index += 1) {
      recordRecentDocument(`Document ${index}`, `/tmp/${index}.fig`);
    }

    const recent = getRecentDocuments();
    expect(recent).toHaveLength(10);
    expect(recent[0]?.path).toBe("/tmp/11.fig");
    expect(recent.at(-1)?.path).toBe("/tmp/2.fig");
  });
});
