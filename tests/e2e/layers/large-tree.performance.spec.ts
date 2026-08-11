import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

import { test, expect } from "@playwright/test";

import { CanvasHelper } from "#tests/helpers/canvas";

const PROFILE = process.env.OPENPENCIL_PERF_PROFILE;
const SAMPLE_COUNT = 60;
const WARMUP_COUNT = 10;
const PROFILE_HOSTS = {
  D1: ["Mac16,6"],
  M1: [],
} as const;

function p95(samples: readonly number[]) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0;
}

test("layer tree meets the named consuming performance contract", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(!PROFILE, "Set OPENPENCIL_PERF_PROFILE=D1 or M1 on a named host.");
  expect(["D1", "M1"]).toContain(PROFILE);
  test.setTimeout(90_000);
  const profile = PROFILE as keyof typeof PROFILE_HOSTS;
  const hostModel =
    process.platform === "darwin"
      ? execFileSync("sysctl", ["-n", "hw.model"], { encoding: "utf8" }).trim()
      : "UNKNOWN";
  expect(PROFILE_HOSTS[profile], `${profile} host identity`).toContain(hostModel);

  const canvas = new CanvasHelper(page);
  await page.goto("/?test&no-rulers");
  await canvas.waitForInit();

  async function addLayers(from: number, to: number) {
    await page.evaluate(
      ({ start, end }) => {
        const store = window.openPencil?.getStore?.();
        if (!store) throw new Error("OpenPencil store not initialized");
        for (let i = start; i < end; i++) {
          store.graph.createNode("RECTANGLE", store.state.currentPageId, {
            name: `Layer ${String(i + 1).padStart(4, "0")}`,
            x: (i % 40) * 24,
            y: Math.floor(i / 40) * 24,
            width: 16,
            height: 16,
          });
        }
        store.requestRender();
      },
      { start: from, end: to },
    );
    await canvas.waitForRender();
  }

  await addLayers(0, 100);
  const rows = page.getByTestId("layers-item");
  const mountedRows100 = await rows.count();
  const layer100 = await page.evaluate(
    async ({ sampleCount, warmupCount }) => {
      const store = window.openPencil?.getStore?.();
      if (!store) throw new Error("OpenPencil store not initialized");
      const samples: number[] = [];
      const longTasks: number[] = [];
      for (let i = 0; i < warmupCount; i++) {
        store.requestRender();
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      }
      const observer = new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "longtask", buffered: false });
      for (let i = 0; i < sampleCount; i++) {
        const startedAt = performance.now();
        store.requestRender();
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        samples.push(performance.now() - startedAt);
      }
      longTasks.push(...observer.takeRecords().map((entry) => entry.duration));
      observer.disconnect();
      return { samples, longTasks };
    },
    { sampleCount: SAMPLE_COUNT, warmupCount: WARMUP_COUNT },
  );

  await addLayers(100, 512);
  const layer512 = await page.evaluate(
    async ({ sampleCount, warmupCount }) => {
      const store = window.openPencil?.getStore?.();
      if (!store) throw new Error("OpenPencil store not initialized");
      const pageNode = store.graph.getNode(store.state.currentPageId);
      if (!pageNode) throw new Error("Current page not found");
      const samples: number[] = [];
      const longTasks: number[] = [];
      for (let i = 0; i < warmupCount; i++) {
        const id = pageNode.childIds[i % pageNode.childIds.length];
        if (!id) throw new Error("Layer not found");
        store.updateNodeWithUndo(id, { x: -i }, "Performance warmup");
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      }
      const observer = new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "longtask", buffered: false });
      for (let i = 0; i < sampleCount; i++) {
        const id = pageNode.childIds[i % pageNode.childIds.length];
        if (!id) throw new Error("Layer not found");
        const startedAt = performance.now();
        store.updateNodeWithUndo(id, { x: i }, "Performance probe");
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        samples.push(performance.now() - startedAt);
      }
      longTasks.push(...observer.takeRecords().map((entry) => entry.duration));
      observer.disconnect();
      return { samples, longTasks };
    },
    { sampleCount: SAMPLE_COUNT, warmupCount: WARMUP_COUNT },
  );

  await addLayers(512, 1200);
  await expect.poll(() => rows.count()).toBeLessThan(200);
  const layer1200 = await page.evaluate(
    async ({ sampleCount, warmupCount }) => {
      const scroller = document.querySelector<HTMLElement>('[data-test-id="layers-scroll"]');
      if (!scroller) throw new Error("Layer scroller not found");
      const samples: number[] = [];
      const longTasks: number[] = [];
      for (let i = 0; i < warmupCount; i++) {
        scroller.scrollTop = i % 2 === 0 ? scroller.scrollHeight : 0;
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      }
      const observer = new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "longtask", buffered: false });
      for (let i = 0; i < sampleCount; i++) {
        const startedAt = performance.now();
        scroller.scrollTop = i % 2 === 0 ? scroller.scrollHeight : 0;
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        samples.push(performance.now() - startedAt);
      }
      longTasks.push(...observer.takeRecords().map((entry) => entry.duration));
      observer.disconnect();
      return { samples, longTasks };
    },
    { sampleCount: SAMPLE_COUNT, warmupCount: WARMUP_COUNT },
  );

  const layer100P95Ms = p95(layer100.samples);
  const layer512P95Ms = p95(layer512.samples);
  const layer1200P95Ms = p95(layer1200.samples);
  const mainThreadMaxMs = Math.max(
    0,
    ...layer100.longTasks,
    ...layer512.longTasks,
    ...layer1200.longTasks,
  );
  const workingTreeDirty =
    execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim().length > 0;
  const evidence = {
    schema: "ch5.open-pencil.layer-tree-performance.v1",
    profile,
    hostModel,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty,
    browserName,
    browserVersion: page.context().browser()?.version() ?? "UNKNOWN",
    userAgent: await page.evaluate(() => navigator.userAgent),
    hardwareConcurrency: await page.evaluate(() => navigator.hardwareConcurrency),
    layer100: { samples: layer100.samples, p95Ms: layer100P95Ms },
    layer512: { samples: layer512.samples, p95Ms: layer512P95Ms },
    layer1200Interaction: { samples: layer1200.samples, p95Ms: layer1200P95Ms },
    mainThread: { budgetMs: 50, observedMaxMs: mainThreadMaxMs },
    mountedRows100,
    mountedRows1200: await rows.count(),
  };
  const evidencePath = testInfo.outputPath("performance-d1-m1-v1.json");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await testInfo.attach("performance-d1-m1-v1", {
    path: evidencePath,
    contentType: "application/json",
  });

  expect.soft(mountedRows100, "100-layer mounted rows").toBeLessThan(100);
  expect.soft(layer100P95Ms, "100-layer frame p95").toBeLessThanOrEqual(33.3);
  expect.soft(layer512P95Ms, "512-layer command p95").toBeLessThanOrEqual(100);
  expect.soft(mainThreadMaxMs, "main-thread task maximum").toBeLessThanOrEqual(50);
});
