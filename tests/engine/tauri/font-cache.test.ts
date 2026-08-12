import { afterEach, describe, expect, test } from "bun:test";

import { clearTauriMocks, mockTauriIPC } from "#tests/helpers/tauri/mocks";
import {
  clearDownloadedFontCache,
  createTauriDownloadedFontCache,
  downloadedFontCacheSummary,
} from "@/app/editor/fonts/cache";

const encoder = new TextEncoder();

afterEach(async () => {
  await clearTauriMocks();
});

describe("Tauri downloaded font cache helpers", () => {
  test("summarizes manifest entries through mocked plugin-fs IPC", async () => {
    await mockTauriIPC((cmd, args) => {
      expect(cmd).toBe("plugin:fs|read_file");
      expect(args).toMatchObject({ path: "cache/v1/font-cache/v1/manifest" });
      return [
        ...encoder.encode(
          JSON.stringify({
            updatedAt: 300,
            value: {
              version: 1,
              entries: {
                one: {
                  family: "Noto Sans SC",
                  style: "Regular",
                  file: "one.ttf",
                  byteLength: 10,
                  sha256: "a",
                  updatedAt: 100,
                },
                two: {
                  family: "Noto Naskh Arabic",
                  style: "Regular",
                  file: "two.ttf",
                  byteLength: 25,
                  sha256: "b",
                  updatedAt: 250,
                },
              },
            },
          }),
        ),
      ];
    });

    await expect(downloadedFontCacheSummary()).resolves.toEqual({
      count: 2,
      byteLength: 35,
      updatedAt: 250,
    });
  });

  test("returns an empty summary when manifest is missing", async () => {
    await mockTauriIPC((cmd) => {
      expect(cmd).toBe("plugin:fs|read_file");
      throw new Error("missing");
    });

    await expect(downloadedFontCacheSummary()).resolves.toEqual({
      count: 0,
      byteLength: 0,
      updatedAt: null,
    });
  });

  test("clears the cache directory through mocked plugin-fs IPC", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    await mockTauriIPC((cmd, args) => {
      calls.push({ cmd, args });
      return null;
    });

    await clearDownloadedFontCache();

    const { BaseDirectory } = await import("@tauri-apps/plugin-fs");
    expect(calls).toEqual([
      {
        cmd: "plugin:fs|remove",
        args: {
          path: "cache/v1/font-cache/v1",
          options: { baseDir: BaseDirectory.AppLocalData, recursive: true },
        },
      },
    ]);
  });

  test("removes staged bytes and skips manifest publication after mid-write abort", async () => {
    const calls: Array<{ cmd: string; path?: string }> = [];
    let releaseByteWrite: (() => void) | undefined;
    let byteWriteStarted: (() => void) | undefined;
    const byteWrite = new Promise<void>((resolve) => {
      byteWriteStarted = resolve;
    });
    const byteWriteRelease = new Promise<void>((resolve) => {
      releaseByteWrite = resolve;
    });
    let writes = 0;
    await mockTauriIPC(async (cmd, args, options) => {
      const path =
        (args as { path?: string }).path ??
        (options as { headers?: { path?: string } } | undefined)?.headers?.path;
      calls.push({ cmd, path });
      if (cmd === "plugin:fs|read_file") throw new Error("missing");
      if (cmd === "plugin:fs|write_file" && writes++ === 0) {
        byteWriteStarted?.();
        await byteWriteRelease;
      }
      return null;
    });

    const controller = new AbortController();
    const writing = createTauriDownloadedFontCache().write(
      "Abort Cache",
      "Regular",
      new Uint8Array([1, 2, 3, 4]).buffer,
      controller.signal,
    );
    await byteWrite;
    controller.abort();
    releaseByteWrite?.();

    await expect(writing).rejects.toBeInstanceOf(DOMException);
    expect(
      calls.some(({ cmd, path }) => cmd === "plugin:fs|remove" && path?.includes("/files/")),
    ).toBe(true);
    expect(
      calls.some(({ cmd, path }) => cmd === "plugin:fs|write_file" && path?.endsWith("/manifest")),
    ).toBe(false);
  });
});
