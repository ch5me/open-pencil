import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

import { test, expect } from "@playwright/test";

import { CanvasHelper } from "#tests/helpers/canvas";

const PROFILE = process.env.OPENPENCIL_PERF_PROFILE;
const M1_HOST_MODEL = process.env.OPENPENCIL_PERF_M1_HOST_MODEL;
const SAMPLE_COUNT = 60;
const WARMUP_COUNT = 10;
const PROFILE_HOSTS = {
  D1: ["Mac16,6"],
  M1: M1_HOST_MODEL ? [M1_HOST_MODEL] : [],
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
  expect(
    PROFILE_HOSTS[profile].length,
    profile === "M1"
      ? "Set OPENPENCIL_PERF_M1_HOST_MODEL to the named M1 hardware model."
      : `${profile} host identity configured`,
  ).toBeGreaterThan(0);
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

  const layerTreeInteraction = await page.evaluate(
    async ({ sampleCount, warmupCount }) => {
      const buttons = [
        ...document.querySelectorAll<HTMLButtonElement>('[data-test-id="layers-item"]'),
      ];
      if (buttons.length < 2) throw new Error("Layer tree interaction rows not mounted");

      const samples: number[] = [];
      const yieldTask = () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });

      for (let i = 0; i < warmupCount; i++) {
        buttons[i % 2]?.click();
        await Promise.resolve();
        await yieldTask();
      }
      for (let i = 0; i < sampleCount; i++) {
        const startedAt = performance.now();
        buttons[i % 2]?.click();
        await Promise.resolve();
        samples.push(performance.now() - startedAt);
        await yieldTask();
      }
      return { samples };
    },
    { sampleCount: SAMPLE_COUNT, warmupCount: WARMUP_COUNT },
  );

  const cachedRepaint = await page.evaluate(
    async ({ sampleCount, warmupCount }) => {
      const store = window.openPencil?.getStore?.();
      const renderer = store?.renderer;
      if (!store || !renderer) throw new Error("OpenPencil renderer not initialized");

      const samples: number[] = [];
      const modes: string[] = [];
      const yieldTask = () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      const render = () => {
        renderer.render(store.graph, store.state.selectedIds, {}, store.state.sceneVersion);
      };

      renderer.profiler.setVisible(true);
      render();
      for (let i = 0; i < warmupCount; i++) {
        render();
        await yieldTask();
      }
      for (let i = 0; i < sampleCount; i++) {
        const startedAt = performance.now();
        render();
        samples.push(performance.now() - startedAt);
        modes.push(renderer.profiler.stats.scenePictureMode);
        await yieldTask();
      }

      const stats = renderer.profiler.stats;
      const profiler = {
        scenePictureMode: stats.scenePictureMode,
        scenePictureCacheHit: stats.scenePictureCacheHit,
        scenePictureMissReason: stats.scenePictureMissReason,
        cpuTimeMs: stats.cpuTime,
        gpuTimeMs: stats.gpuTime,
        drawCalls: stats.drawCalls,
        totalNodes: stats.totalNodes,
        culledNodes: stats.culledNodes,
      };
      renderer.profiler.setVisible(false);
      return { samples, modes, profiler };
    },
    { sampleCount: SAMPLE_COUNT, warmupCount: WARMUP_COUNT },
  );

  await addLayers(100, 512);
  const layer512Edit = await page.evaluate(
    async ({ sampleCount, warmupCount }) => {
      const store = window.openPencil?.getStore?.();
      const renderer = store?.renderer;
      if (!store || !renderer) throw new Error("OpenPencil renderer not initialized");
      const pageNode = store.graph.getNode(store.state.currentPageId);
      if (!pageNode || pageNode.childIds.length !== 512) {
        throw new Error(`Expected 512 editable layers, got ${pageNode?.childIds.length ?? 0}`);
      }

      const samples: number[] = [];
      const firstRow = document.querySelector('[data-test-id="layers-item"]');
      const selectedBefore = [...store.state.selectedIds];
      const yieldTask = () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      const render = () => {
        renderer.render(store.graph, store.state.selectedIds, {}, store.state.sceneVersion);
      };

      renderer.profiler.setVisible(true);
      for (let i = 0; i < warmupCount; i++) {
        const id = pageNode.childIds[i % pageNode.childIds.length];
        if (!id) throw new Error("Layer not found");
        store.updateNodeWithUndo(id, { x: -(i + 1) }, "Performance warmup");
        render();
        await yieldTask();
      }
      for (let i = 0; i < sampleCount; i++) {
        const id = pageNode.childIds[i % pageNode.childIds.length];
        if (!id) throw new Error("Layer not found");
        const startedAt = performance.now();
        store.updateNodeWithUndo(id, { x: i + 1 }, "Performance probe");
        render();
        samples.push(performance.now() - startedAt);
        await yieldTask();
      }

      const lastEditedId = pageNode.childIds[(sampleCount - 1) % pageNode.childIds.length];
      const stats = renderer.profiler.stats;
      const profiler = {
        scenePictureMode: stats.scenePictureMode,
        scenePictureCacheHit: stats.scenePictureCacheHit,
        scenePictureMissReason: stats.scenePictureMissReason,
        cpuTimeMs: stats.cpuTime,
        gpuTimeMs: stats.gpuTime,
        drawCalls: stats.drawCalls,
        totalNodes: stats.totalNodes,
        culledNodes: stats.culledNodes,
      };
      renderer.profiler.setVisible(false);

      return {
        samples,
        profiler,
        editedNodeCount: pageNode.childIds.length,
        lastEditedX: lastEditedId ? store.graph.getNode(lastEditedId)?.x : null,
        selectedBefore,
        selectedAfter: [...store.state.selectedIds],
        firstRowIdentityPreserved:
          firstRow !== null && firstRow === document.querySelector('[data-test-id="layers-item"]'),
      };
    },
    { sampleCount: SAMPLE_COUNT, warmupCount: WARMUP_COUNT },
  );

  await addLayers(512, 1200);
  await expect.poll(() => rows.count()).toBeLessThan(200);

  const layerTreeInteractionP95Ms = p95(layerTreeInteraction.samples);
  const cachedRepaintP95Ms = p95(cachedRepaint.samples);
  const layer512EditP95Ms = p95(layer512Edit.samples);
  const mainThreadMaxMs = Math.max(
    0,
    ...layerTreeInteraction.samples,
    ...cachedRepaint.samples,
    ...layer512Edit.samples,
  );
  const workingTreeDirty =
    execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim().length > 0;
  const identity = {
    profile,
    hostModel,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty,
    browserName,
    browserVersion: page.context().browser()?.version() ?? "UNKNOWN",
    userAgent: await page.evaluate(() => navigator.userAgent),
    hardwareConcurrency: await page.evaluate(() => navigator.hardwareConcurrency),
  };
  const evidence = {
    schema: "ch5.open-pencil.layer-tree-performance.v2",
    identity,
    layerTreeInteraction: {
      samples: layerTreeInteraction.samples,
      p95Ms: layerTreeInteractionP95Ms,
    },
    cachedRepaint: {
      samples: cachedRepaint.samples,
      p95Ms: cachedRepaintP95Ms,
      modes: cachedRepaint.modes,
      profiler: cachedRepaint.profiler,
    },
    layer512Edit: {
      samples: layer512Edit.samples,
      p95Ms: layer512EditP95Ms,
      profiler: layer512Edit.profiler,
      editedNodeCount: layer512Edit.editedNodeCount,
      lastEditedX: layer512Edit.lastEditedX,
      selectedBefore: layer512Edit.selectedBefore,
      selectedAfter: layer512Edit.selectedAfter,
      firstRowIdentityPreserved: layer512Edit.firstRowIdentityPreserved,
    },
    mainThread: { budgetMs: 50, observedMaxMs: mainThreadMaxMs },
    mountedRows100,
    mountedRows1200: await rows.count(),
  };
  const evidencePath = testInfo.outputPath("layer-tree-performance-v2.json");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await testInfo.attach("layer-tree-performance-v2", {
    path: evidencePath,
    contentType: "application/json",
  });

  expect.soft(mountedRows100, "100-layer mounted rows").toBeLessThan(100);
  expect
    .soft(layerTreeInteractionP95Ms, "100-layer tree interaction p95")
    .toBeLessThanOrEqual(33.3);
  expect.soft(cachedRepaintP95Ms, "100-layer cached repaint p95").toBeLessThanOrEqual(33.3);
  expect
    .soft(
      cachedRepaint.modes.every((mode) => mode === "hit"),
      "cached repaint modes",
    )
    .toBe(true);
  expect.soft(cachedRepaint.profiler.scenePictureMode, "cached repaint profiler mode").toBe("hit");
  expect
    .soft(cachedRepaint.profiler.scenePictureCacheHit, "cached repaint profiler cache hit")
    .toBe(true);
  expect.soft(layer512Edit.editedNodeCount, "512-layer edit node count").toBe(512);
  expect.soft(layer512Edit.lastEditedX, "512-layer real edit result").toBe(SAMPLE_COUNT);
  expect
    .soft(layer512Edit.selectedAfter, "selection preserved across edits")
    .toEqual(layer512Edit.selectedBefore);
  expect.soft(layer512Edit.firstRowIdentityPreserved, "layer row identity").toBe(true);
  expect.soft(layer512EditP95Ms, "512-layer command p95").toBeLessThanOrEqual(100);
  expect.soft(mainThreadMaxMs, "main-thread task maximum").toBeLessThanOrEqual(50);
});
