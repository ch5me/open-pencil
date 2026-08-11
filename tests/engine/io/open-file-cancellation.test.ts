import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { getActiveStore, openFileInNewTab } from "@/app/tabs";
import { beginFileOpen } from "@/app/tabs/open-controller";

test("a new file open cancels the previous open", () => {
  const first = beginFileOpen();
  const second = beginFileOpen();

  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(false);
  expect(first.isCurrent()).toBe(false);
  expect(second.isCurrent()).toBe(true);
  first.finish();
  expect(second.isCurrent()).toBe(true);
  second.finish();
});

test("file open follows caller cancellation and removes it after finish", () => {
  const parent = new AbortController();
  const open = beginFileOpen(parent.signal);
  parent.abort("cancelled");

  expect(open.signal.aborted).toBe(true);
  expect(open.signal.reason).toBe("cancelled");
  open.finish();
});

test("overlapping file opens publish only the replacement and keep loading owned", async () => {
  Object.assign(globalThis, {
    window: { innerWidth: 1024, innerHeight: 768, openPencil: {} },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    },
  });
  const source = readFileSync(new URL("../../fixtures/pencil_simple.pen", import.meta.url), "utf8");
  let releaseFirst: ((value: ArrayBuffer) => void) | undefined;
  let firstReadStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    firstReadStarted = resolve;
  });
  const firstBytes = new Promise<ArrayBuffer>((resolve) => {
    releaseFirst = resolve;
  });
  const first = new File([source], "first.pen");
  Object.defineProperty(first, "arrayBuffer", {
    value: () => {
      firstReadStarted?.();
      return firstBytes;
    },
  });

  const firstOpen = openFileInNewTab(first);
  await started;
  const secondOpen = openFileInNewTab(new File([source], "second.pen"));
  await secondOpen;
  expect(getActiveStore().state.documentName).toBe("second");
  expect(getActiveStore().state.loading).toBe(false);

  releaseFirst?.(new TextEncoder().encode(source).buffer);
  await expect(firstOpen).resolves.toBeUndefined();
  expect(getActiveStore().state.documentName).toBe("second");
  expect(getActiveStore().state.loading).toBe(false);
});

test("cancelled DOM open cannot clear a replacement open loading state", async () => {
  const source = readFileSync(new URL("../../fixtures/pencil_simple.pen", import.meta.url), "utf8");
  let releaseDOM: ((value: string) => void) | undefined;
  let domReadStarted: (() => void) | undefined;
  const domStarted = new Promise<void>((resolve) => {
    domReadStarted = resolve;
  });
  const domText = new Promise<string>((resolve) => {
    releaseDOM = resolve;
  });
  const domFile = new File(["<main>stale</main>"], "stale.html");
  Object.defineProperty(domFile, "text", {
    value: () => {
      domReadStarted?.();
      return domText;
    },
  });

  let releasePen: ((value: ArrayBuffer) => void) | undefined;
  let penReadStarted: (() => void) | undefined;
  const penStarted = new Promise<void>((resolve) => {
    penReadStarted = resolve;
  });
  const penBytes = new Promise<ArrayBuffer>((resolve) => {
    releasePen = resolve;
  });
  const penFile = new File([source], "replacement.pen");
  Object.defineProperty(penFile, "arrayBuffer", {
    value: () => {
      penReadStarted?.();
      return penBytes;
    },
  });

  const domOpen = openFileInNewTab(domFile);
  await domStarted;
  const penOpen = openFileInNewTab(penFile);
  await penStarted;
  releaseDOM?.("<main>stale</main>");
  await domOpen;
  expect(getActiveStore().state.loading).toBe(true);

  releasePen?.(new TextEncoder().encode(source).buffer);
  await penOpen;
  expect(getActiveStore().state.documentName).toBe("replacement");
  expect(getActiveStore().state.loading).toBe(false);
});
